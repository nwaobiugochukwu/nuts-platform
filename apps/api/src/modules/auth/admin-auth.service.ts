import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';

import { RefreshSessionService } from '@api/modules/auth/sessions/refresh-session.service';
import type { AuthSession } from '@api/modules/auth/types/auth.types';
import { ADMIN_AUTH_SELECT } from '@api/modules/auth/auth.selects';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import {
  BCRYPT_COST_FACTOR,
  UNKNOWN_ACCOUNT_PASSWORD_HASH,
} from '@api/common/constants/bcrypt.constants';
import { AdminAuthUserDto } from './dto/admin-auth-user.dto';
import { AdminRegisterDto } from './dto/admin-register.dto';
import { LoginDto } from '@api/modules/auth/dto/login.dto';
import { auditDetails } from '@api/modules/audit/utils/audit-details.util';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly accountLockService: AccountLockService,
    private readonly refreshSessionService: RefreshSessionService,
  ) {}

  async login(
    dto: LoginDto,
  ): Promise<{ user: AdminAuthUserDto; tokens: AuthSession['tokens'] }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const identifier = `email:${normalizedEmail}`;

    const admin = await this.prisma.admin.findUnique({
      where: { email: normalizedEmail },
      select: { ...ADMIN_AUTH_SELECT, password: true },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      admin?.password ?? UNKNOWN_ACCOUNT_PASSWORD_HASH,
    );

    if (!admin || !passwordMatches) {
      this.logger.warn('Failed admin login attempt');
      await this.accountLockService
        .recordFailedAttempt(identifier)
        .catch((error: unknown) => {
          this.logger.warn(
            'Failed to persist admin login failure count',
            error,
          );
        });
      auditDetails({
        action: 'ADMIN_LOGIN_FAILED',
        entityId: admin?.id,
        payload: { credentialType: 'email' },
      });
      throw new UnauthorizedException('Invalid admin credentials');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    void this.accountLockService
      .resetAttempts(identifier)
      .catch((error: unknown) => {
        this.logger.warn('Failed to reset admin login failure count', error);
      });

    // Upgrade weak legacy hashes after successful login
    if (bcrypt.getRounds(admin.password) < BCRYPT_COST_FACTOR) {
      bcrypt
        .hash(dto.password, BCRYPT_COST_FACTOR)
        .then((upgradedHash) =>
          this.prisma.admin.update({
            where: { id: admin.id },
            data: { password: upgradedHash },
          }),
        )
        .catch((err: unknown) => {
          this.logger.warn('Failed to upgrade admin password hash cost', err);
        });
    }

    const session = await this.refreshSessionService.issueAdminSession(admin);

    // Fire-and-forget audit log
    auditDetails({
      action: 'ADMIN_LOGIN',
      entityId: admin.id,
      adminId: admin.id,
      payload: { role: 'ADMIN' },
    });

    return { user: this.toAuthUserDto(admin), tokens: session.tokens };
  }

  async setup(
    dto: AdminRegisterDto,
  ): Promise<{ user: AdminAuthUserDto; tokens: AuthSession['tokens'] }> {
    const setupSecret = this.configService.get<string>('ADMIN_SETUP_SECRET');
    if (!setupSecret) {
      throw new BadRequestException('Admin setup is not configured');
    }

    const providedSecret = dto.setupSecret || dto.secret;
    const providedSecretBuffer = Buffer.from(providedSecret ?? '', 'utf8');
    const expectedSecretBuffer = Buffer.from(setupSecret, 'utf8');
    if (
      providedSecretBuffer.length !== expectedSecretBuffer.length ||
      !timingSafeEqual(providedSecretBuffer, expectedSecretBuffer)
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST_FACTOR);

    let admin;
    try {
      admin = await this.prisma.$transaction(
        async (tx) => {
          const existingAdmins = await tx.admin.count();
          if (existingAdmins > 0) {
            throw new ConflictException(
              'Admin setup has already been completed',
            );
          }

          return tx.admin.create({
            data: {
              email: normalizedEmail,
              password: hashedPassword,
              role: ROLE.ADMIN,
              firstName: dto.firstName ?? null,
              lastName: dto.lastName ?? null,
            },
            select: ADMIN_AUTH_SELECT,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Admin setup is already in progress or has been completed',
        );
      }
      throw error;
    }

    this.logger.log('Initial admin account created');

    auditDetails({
      entityId: admin.id,
      adminId: admin.id,
      payload: { role: 'ADMIN' },
    });

    const session = await this.refreshSessionService.issueAdminSession(admin);
    return { user: this.toAuthUserDto(admin), tokens: session.tokens };
  }

  async refresh(
    adminId: string,
    refreshId?: string,
    sessionId?: string,
  ): Promise<{ user: AdminAuthUserDto; tokens: AuthSession['tokens'] }> {
    if (!refreshId) {
      throw new UnauthorizedException('Invalid refresh session');
    }

    // Delegate to the consolidated refresh logic which has:
    // - grace period for concurrent requests
    // - token reuse detection with session revocation
    // - timing-safe hash verification
    const session = await this.refreshSessionService.refresh({
      sub: adminId,
      role: ROLE.ADMIN,
      refreshId,
      ...(sessionId ? { sessionId } : {}),
    });

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName ?? null,
        lastName: session.user.lastName ?? null,
      },
      tokens: session.tokens,
    };
  }

  async me(adminId: string): Promise<AdminAuthUserDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: ADMIN_AUTH_SELECT,
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    return this.toAuthUserDto(admin);
  }

  async updateProfile(
    adminId: string,
    dto: { firstName?: string; lastName?: string },
  ): Promise<AdminAuthUserDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, isActive: true },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    const updated = await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        ...(dto.firstName !== undefined
          ? { firstName: dto.firstName.trim() }
          : {}),
        ...(dto.lastName !== undefined
          ? { lastName: dto.lastName.trim() }
          : {}),
      },
      select: ADMIN_AUTH_SELECT,
    });

    return this.toAuthUserDto(updated);
  }

  async logout(
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
    sessionId?: string,
  ): Promise<void> {
    // Sign out THIS device only. Tokens issued before per-device sessions carry
    // no session id and fall back to revoking the account's legacy session.
    if (sessionId) {
      await this.refreshSessionService.revokeAccountSession(sessionId);
    } else {
      await this.refreshSessionService.revokeSession(adminId, ROLE.ADMIN);
    }

    auditDetails({
      entityId: adminId,
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PRIVATE HELPERS
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private toAuthUserDto(admin: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }): AdminAuthUserDto {
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
    };
  }
}
