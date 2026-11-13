import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { OtpService } from '@api/modules/auth/otp/otp.service';
import { RefreshSessionService } from '@api/modules/auth/sessions/refresh-session.service';
import { GoogleAuthService } from '@api/modules/auth/google-auth.service';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import {
  BCRYPT_COST_FACTOR,
  UNKNOWN_ACCOUNT_PASSWORD_HASH,
} from '@api/common/constants/bcrypt.constants';
import { generateSlug } from '@api/common/utils/slug.util';

import { CreateVendorDto } from './dto/create-vendor.dto';
import { VendorLoginDto } from './dto/update-vendor.dto';
import { VendorGoogleAuthDto } from './dto/vendor-google-auth.dto';
import { VendorResetPasswordDto } from './dto/vendor-reset-password.dto';
import { VendorProfileDto } from './dto/vendor-response.dto';
import type { AuthTokens } from '@api/modules/auth/types/auth.types';

export const vendorAuthSelect = {
  id: true,
  email: true,
  storeName: true,
  storeSlug: true,
  storeDescription: true,
  businessPhone: true,
  businessEmail: true,
  storeLogoUrl: true,
  storeLogoAltText: true,
  isVerified: true,
  isActive: true,
  isApproved: true,
  firstName: true,
  lastName: true,
  phone: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
  avatarUrl: true,
  authProvider: true,
} as const;

export type VendorAuthRecord = Prisma.VendorGetPayload<{
  select: typeof vendorAuthSelect;
}>;

export interface VendorAuthSession {
  profile: VendorProfileDto;
  tokens: AuthTokens | null;
}

@Injectable()
export class VendorAuthService {
  private readonly logger = new Logger(VendorAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    private readonly accountLockService: AccountLockService,
    private readonly refreshSessionService: RefreshSessionService,
    private readonly googleAuthService?: GoogleAuthService,
  ) {}

  async requestRegistrationOtp(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingVendor = await this.prisma.vendor.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingVendor) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_EXISTS',
        message:
          'A vendor account with this email already exists. Please sign in instead.',
      });
    }

    await this.otpService.createOtp(normalizedEmail, 'vendor:registration');
  }

  // ---------------------------------------------------------------------------
  // REGISTER
  // ---------------------------------------------------------------------------

  async register(
    dto: CreateVendorDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorAuthSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const slugSource = dto.storeSlug?.trim() || dto.storeName.trim();
    const storeSlug = generateSlug(slugSource);

    if (!storeSlug) {
      throw new BadRequestException('Invalid store slug or store name');
    }

    const existingVendor = await this.prisma.vendor.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { storeSlug }],
      },
      select: { id: true, email: true },
    });

    if (existingVendor) {
      if (existingVendor.email === normalizedEmail) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message:
            'A vendor account with this email already exists. Please sign in instead.',
        });
      }
      throw new ConflictException('Email or store slug already in use');
    }

    await this.otpService.verifyOtp(
      normalizedEmail,
      dto.otpCode,
      'vendor:registration',
    );

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST_FACTOR);

    let vendor: VendorAuthRecord;
    try {
      vendor = await this.prisma.vendor.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          storeName: dto.storeName.trim(),
          storeSlug,
          storeDescription: dto.storeDescription?.trim() ?? '',
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail?.trim() ?? '',
          firstName: dto.firstName?.trim() ?? '',
          lastName: dto.lastName?.trim() ?? '',
          phone: dto.phone,
          vendorWallet: {
            create: {},
          },
        },
        select: vendorAuthSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === 'string'
            ? [target]
            : [];
        if (fields.some((field) => field.toLowerCase().includes('email'))) {
          throw new ConflictException({
            code: 'ACCOUNT_ALREADY_EXISTS',
            message:
              'A vendor account with this email already exists. Please sign in instead.',
          });
        }
        throw new ConflictException('Email or store slug already in use');
      }
      throw error;
    }

    void this.auditLog
      .log({
        action: 'VENDOR_REGISTER',
        entity: 'Vendor',
        entityId: vendor.id,
        payload: {
          email: vendor.email,
          storeName: vendor.storeName,
          storeSlug: vendor.storeSlug,
        },
        ipAddress,
        userAgent,
      })
      .catch((error: unknown) => {
        this.logger.warn('Failed to log vendor registration audit', error);
      });

    void this.emailService
      .sendVendorApplicationReceivedEmail(
        vendor.email,
        vendor.storeName,
        vendor.firstName || undefined,
      )
      .catch((error: unknown) => {
        this.logger.error(
          'Failed to send vendor application received email',
          error,
        );
      });

    // Vendor registration does NOT auto-login. Unapproved vendors cannot have an active session.
    return {
      profile: this.toVendorProfile(vendor),
      tokens: null,
    };
  }

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------

  async login(
    dto: VendorLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorAuthSession> {
    const email = dto.email.trim().toLowerCase();
    const identifier = `vendor:${email}`;

    const vendor = await this.prisma.vendor.findUnique({
      where: { email },
      select: {
        ...vendorAuthSelect,
        password: true,
      },
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      vendor?.password ?? UNKNOWN_ACCOUNT_PASSWORD_HASH,
    );

    if (vendor && !vendor.password) {
      throw new UnauthorizedException(
        'This vendor account was created with Google Sign-In. Please sign in with Google.',
      );
    }

    if (!vendor || !passwordMatches) {
      await Promise.allSettled([
        this.accountLockService.recordFailedAttempt(identifier),
        this.auditLog.log({
          action: 'VENDOR_LOGIN_FAILED',
          entity: 'Vendor',
          entityId: vendor?.id,
          payload: { credentialType: 'email' },
          ipAddress,
          userAgent,
        }),
      ]);

      throw new UnauthorizedException('Invalid credentials');
    }

    if (!vendor.isActive) {
      throw new UnauthorizedException('Vendor account is deactivated');
    }

    if (!vendor.isApproved) {
      throw new UnauthorizedException('Vendor account is not approved yet');
    }

    void this.accountLockService
      .resetAttempts(identifier)
      .catch((error: unknown) => {
        this.logger.warn('Failed to reset vendor login attempts', error);
      });

    // Asynchronously upgrade password hash cost if stale
    const hashCost = vendor.password
      ? Number(vendor.password.split('$')[2])
      : 0;
    if (Number.isFinite(hashCost) && hashCost < BCRYPT_COST_FACTOR) {
      void bcrypt
        .hash(dto.password, BCRYPT_COST_FACTOR)
        .then((upgradedHash) =>
          this.prisma.vendor.update({
            where: { id: vendor.id },
            data: { password: upgradedHash },
          }),
        )
        .catch((error: unknown) => {
          this.logger.warn(
            'Failed to upgrade vendor password hash cost',
            error,
          );
        });
    }

    const session = await this.refreshSessionService.issueVendorSession({
      id: vendor.id,
      email: vendor.email,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      isActive: vendor.isActive,
      isApproved: vendor.isApproved,
      tokenVersion: vendor.tokenVersion,
    });

    void this.auditLog
      .log({
        action: 'VENDOR_LOGIN',
        entity: 'Vendor',
        entityId: vendor.id,
        payload: { role: 'VENDOR' },
        ipAddress,
        userAgent,
      })
      .catch((error: unknown) => {
        this.logger.warn('Failed to write vendor login audit log', error);
      });

    return {
      profile: this.toVendorProfile(vendor),
      tokens: session.tokens,
    };
  }

  // ---------------------------------------------------------------------------
  // GOOGLE OAUTH
  // ---------------------------------------------------------------------------

  async googleAuth(
    dto: VendorGoogleAuthDto,
    ipAddress?: string,
    userAgent?: string,
    intent: 'login' | 'signup' = 'signup',
  ): Promise<VendorAuthSession> {
    if (!this.googleAuthService) {
      throw new BadRequestException('Google authentication is not configured');
    }

    const payload = await this.googleAuthService.verifyIdToken(dto.idToken);
    const identifier = `email:${payload.email}`;
    const accountExistsError = () =>
      new ConflictException({
        code: 'GOOGLE_ACCOUNT_EXISTS',
        message:
          'A vendor account with this Google email already exists. Please sign in instead.',
      });

    // 1. Existing vendor by googleId
    const existingByGoogleId = await this.prisma.vendor.findUnique({
      where: { googleId: payload.googleId },
      select: vendorAuthSelect,
    });

    if (existingByGoogleId && intent === 'signup') {
      throw accountExistsError();
    }

    if (existingByGoogleId) {
      if (!existingByGoogleId.isActive) {
        throw new UnauthorizedException('Vendor account is deactivated');
      }

      if (!existingByGoogleId.isApproved) {
        throw new UnauthorizedException('Vendor account is not approved yet');
      }

      void this.accountLockService
        .resetAttempts(identifier)
        .catch((err: unknown) => {
          this.logger.warn('Failed to reset vendor login attempts', err);
        });

      const session = await this.refreshSessionService.issueVendorSession({
        id: existingByGoogleId.id,
        email: existingByGoogleId.email,
        firstName: existingByGoogleId.firstName,
        lastName: existingByGoogleId.lastName,
        isActive: existingByGoogleId.isActive,
        isApproved: existingByGoogleId.isApproved,
        tokenVersion: existingByGoogleId.tokenVersion,
      });

      void this.auditLog
        .log({
          action: 'VENDOR_GOOGLE_LOGIN',
          entity: 'Vendor',
          entityId: existingByGoogleId.id,
          payload: { role: 'VENDOR', authProvider: 'GOOGLE' },
          ipAddress,
          userAgent,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            'Failed to write vendor google login audit log',
            err,
          );
        });

      return {
        profile: this.toVendorProfile(existingByGoogleId),
        tokens: session.tokens,
      };
    }

    // 2. Existing vendor by email
    const existingByEmail = await this.prisma.vendor.findUnique({
      where: { email: payload.email },
      select: vendorAuthSelect,
    });

    if (existingByEmail && intent === 'signup') {
      throw accountExistsError();
    }

    if (existingByEmail) {
      if (!existingByEmail.isActive) {
        throw new UnauthorizedException('Vendor account is deactivated');
      }

      const linkedVendor = await this.prisma.vendor.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: payload.googleId,
          avatarUrl: existingByEmail.avatarUrl ?? payload.avatarUrl,
          isVerified: true,
        },
        select: vendorAuthSelect,
      });

      if (!linkedVendor.isApproved) {
        return {
          profile: this.toVendorProfile(linkedVendor),
          tokens: null,
        };
      }

      void this.accountLockService
        .resetAttempts(identifier)
        .catch((err: unknown) => {
          this.logger.warn('Failed to reset vendor login attempts', err);
        });

      const session = await this.refreshSessionService.issueVendorSession({
        id: linkedVendor.id,
        email: linkedVendor.email,
        firstName: linkedVendor.firstName,
        lastName: linkedVendor.lastName,
        isActive: linkedVendor.isActive,
        isApproved: linkedVendor.isApproved,
        tokenVersion: linkedVendor.tokenVersion,
      });

      void this.auditLog
        .log({
          action: 'VENDOR_GOOGLE_ACCOUNT_LINKED',
          entity: 'Vendor',
          entityId: linkedVendor.id,
          payload: {
            role: 'VENDOR',
            previousProvider: existingByEmail.authProvider,
          },
          ipAddress,
          userAgent,
        })
        .catch((err: unknown) => {
          this.logger.warn('Failed to write vendor google link audit log', err);
        });

      return {
        profile: this.toVendorProfile(linkedVendor),
        tokens: session.tokens,
      };
    }

    if (intent === 'login') {
      throw new UnauthorizedException({
        code: 'GOOGLE_ACCOUNT_NOT_FOUND',
        message:
          'No vendor account is associated with this Google account. Please sign up first.',
      });
    }

    // 3. New vendor registration via Google
    if (!dto.storeName?.trim()) {
      throw new BadRequestException(
        'storeName is required for new vendor registration',
      );
    }

    const effectiveStoreName = dto.storeName.trim();

    const baseSlug =
      generateSlug(effectiveStoreName) ||
      `store-${Math.random().toString(36).slice(2, 8)}`;

    const storeSlug = baseSlug;

    const slugExists = await this.prisma.vendor.findUnique({
      where: { storeSlug },
      select: { id: true },
    });

    const finalSlug = slugExists
      ? `${storeSlug}-${Math.random().toString(36).slice(2, 7)}`
      : storeSlug;

    let newVendor: VendorAuthRecord;
    try {
      newVendor = await this.prisma.vendor.create({
        data: {
          email: payload.email,
          password: null,
          googleId: payload.googleId,
          authProvider: 'GOOGLE',
          avatarUrl: payload.avatarUrl,
          firstName: payload.firstName,
          lastName: payload.lastName,
          storeName: effectiveStoreName,
          storeSlug: finalSlug,
          storeDescription: dto.storeDescription?.trim() ?? '',
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail?.trim() ?? payload.email,
          isVerified: true,
          isApproved: false,
          vendorWallet: {
            create: {},
          },
        },
        select: vendorAuthSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === 'string'
            ? [target]
            : [];
        if (
          fields.some((field) => {
            const normalizedField = field.toLowerCase();
            return (
              normalizedField.includes('email') ||
              normalizedField.includes('googleid')
            );
          })
        ) {
          throw accountExistsError();
        }
        throw new ConflictException('Email or store slug already in use');
      }
      throw error;
    }

    void this.auditLog
      .log({
        action: 'VENDOR_GOOGLE_REGISTER',
        entity: 'Vendor',
        entityId: newVendor.id,
        payload: {
          email: newVendor.email,
          storeName: newVendor.storeName,
          storeSlug: newVendor.storeSlug,
          authProvider: 'GOOGLE',
        },
        ipAddress,
        userAgent,
      })
      .catch((err: unknown) => {
        this.logger.warn('Failed to write vendor registration audit log', err);
      });

    void this.emailService
      .sendVendorApplicationReceivedEmail(
        newVendor.email,
        newVendor.storeName,
        newVendor.firstName || undefined,
      )
      .catch((err: unknown) => {
        this.logger.error('Failed to send vendor welcome email', err);
      });

    return {
      profile: this.toVendorProfile(newVendor),
      tokens: null,
    };
  }

  // ---------------------------------------------------------------------------
  // TOKEN REFRESH
  // ---------------------------------------------------------------------------

  async refresh(
    vendorId: string,
    expectedRefreshId: string,
  ): Promise<VendorAuthSession> {
    const session = await this.refreshSessionService.refresh({
      sub: vendorId,
      role: ROLE.VENDOR,
      refreshId: expectedRefreshId,
    });

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: vendorAuthSelect,
    });

    if (!vendor) {
      throw new UnauthorizedException('Vendor not found');
    }

    return {
      profile: this.toVendorProfile(vendor),
      tokens: session.tokens,
    };
  }

  // ---------------------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------------------

  async logout(
    vendorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.refreshSessionService.revokeSession(vendorId, ROLE.VENDOR);

    await this.auditLog.log({
      action: 'VENDOR_LOGOUT',
      entity: 'Vendor',
      entityId: vendorId,
      ipAddress,
      userAgent,
    });
  }

  // ---------------------------------------------------------------------------
  // PASSWORD RESET
  // ---------------------------------------------------------------------------

  async resetPassword(
    dto: VendorResetPasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const vendor = await this.prisma.vendor.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, firstName: true },
    });

    if (!vendor) {
      throw new BadRequestException('Invalid email or reset code');
    }

    await this.otpService.verifyOtp(
      normalizedEmail,
      dto.otpCode,
      'password-reset',
    );

    const hashedPassword = await bcrypt.hash(
      dto.newPassword,
      BCRYPT_COST_FACTOR,
    );

    await this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        password: hashedPassword,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    await this.refreshSessionService.revokeSession(vendor.id, ROLE.VENDOR);

    await this.auditLog.log({
      action: 'VENDOR_RESET_PASSWORD',
      entity: 'Vendor',
      entityId: vendor.id,
      ipAddress,
      userAgent,
    });

    void this.emailService
      .sendPasswordResetSuccessEmail(dto.email, vendor.firstName ?? '')
      .catch((error: unknown) => {
        this.logger.error(
          'Failed to send password reset confirmation email',
          error,
        );
      });
  }

  // ---------------------------------------------------------------------------
  // HELPER
  // ---------------------------------------------------------------------------

  toVendorProfile(vendor: VendorAuthRecord): VendorProfileDto {
    return {
      id: vendor.id,
      email: vendor.email,
      storeName: vendor.storeName,
      storeSlug: vendor.storeSlug,
      storeLogo: vendor.storeLogoUrl,
      storeLogoUrl: vendor.storeLogoUrl,
      storeLogoAltText: vendor.storeLogoAltText,
      storeDescription: vendor.storeDescription,
      businessPhone: vendor.businessPhone,
      businessEmail: vendor.businessEmail,
      isVerified: vendor.isVerified,
      isActive: vendor.isActive,
      isApproved: vendor.isApproved,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      phone: vendor.phone,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
    };
  }
}
