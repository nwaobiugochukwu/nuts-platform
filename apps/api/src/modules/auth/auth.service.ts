import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { ReferralService } from '@api/modules/referral/referral.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import { AuditLogService } from '@api/modules/shared/audit-log/audit-log.service';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleAuthService } from './google-auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { VerifyOtpResponseDto } from './dto/auth-response.dto';
import { OtpService } from './otp/otp.service';
import {
  BCRYPT_COST_FACTOR,
  UNKNOWN_ACCOUNT_PASSWORD_HASH,
} from '@api/modules/shared/constants/bcrypt.constants';
import { USER_AUTH_SELECT, USER_LOGIN_SELECT } from './auth.selects';
import type { AuthSession } from './types/auth.types';
import { RefreshSessionService } from './sessions/refresh-session.service';
import type { RefreshJwtPayload } from './types/refresh-jwt-payload.type';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import { parseSuspension } from '@api/modules/users/utils/suspension.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    private readonly referralService: ReferralService,
    private readonly accountLockService: AccountLockService,
    private readonly refreshSessionService: RefreshSessionService,
    private readonly googleAuthService?: GoogleAuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // REGISTER
  // ---------------------------------------------------------------------------

  async register(
    dto: RegisterDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthSession> {
    const email = this.normalizeEmail(dto.email);

    // If already pre-verified in Step 2, consume verification token.
    // Otherwise, verify and consume the OTP code directly.
    const isPreVerified = await this.otpService.consumeVerification(
      email,
      'registration',
    );
    if (!isPreVerified) {
      await this.otpService.verifyOtp(email, dto.otpCode, 'registration');
    }

    // Validate the referral code before creating the user.
    // We only keep the IDs required inside the transaction.
    const referral = dto.referralCode
      ? await this.referralService.validateReferralCode(dto.referralCode, email)
      : null;

    const password = await bcrypt.hash(dto.password, BCRYPT_COST_FACTOR);

    try {
      /*
       * Everything that creates the user's initial database state belongs
       * to ONE transaction.
       *
       * If wallet creation, address creation, referral creation, or referral
       * code creation fails, the user itself is rolled back.
       *
       * We intentionally do NOT use Serializable here. The database UNIQUE
       * constraints already protect things such as duplicate email/code,
       * while Serializable would add unnecessary contention to registration.
       */
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email,
            password,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            isEmailVerified: true,
          },
          select: USER_AUTH_SELECT,
        });

        await tx.userWallet.create({
          data: {
            userId: createdUser.id,
          },
        });

        if (dto.shippingAddress) {
          await tx.shippingAddress.create({
            data: {
              userId: createdUser.id,
              fullName: dto.shippingAddress.fullName,
              phone: dto.shippingAddress.phone,
              street: dto.shippingAddress.street,
              city: dto.shippingAddress.city,
              state: dto.shippingAddress.state,
              country: dto.shippingAddress.country ?? 'Nigeria',
              isDefault: true,
            },
          });
        }

        /*
         * Create the user's own referral code using the SAME transaction
         * client. This means the code cannot survive if registration fails.
         */
        await this.referralService.createReferralCode(tx, createdUser.id);

        /*
         * If a referral was supplied, create the relationship using the
         * transaction client as well.
         *
         * Do not call this.prisma here. That would escape the transaction.
         */
        if (referral) {
          await this.referralService.applyReferralAtSignupById(
            tx,
            createdUser.id,
            referral.id,
            referral.userId,
          );
        }

        return createdUser;
      });

      /*
       * Session creation happens AFTER registration commits.
       *
       * JWT generation and refresh-token persistence are authentication
       * concerns and are intentionally outside the registration transaction.
       */
      const session = await this.refreshSessionService.issueUserSession(user);

      this.fireAndForget(
        this.auditLog.log({
          action: 'USER_REGISTER',
          entity: 'User',
          entityId: user.id,
          userId: user.id,
          payload: {
            hasReferral: Boolean(referral),
          },
          ipAddress,
          userAgent,
        }),
        'registration audit log',
      );

      this.fireAndForget(
        this.emailService.sendWelcomeEmail(email, dto.firstName ?? ''),
        'welcome email',
      );

      return session;
    } catch (error) {
      if (this.isUserEmailUniqueViolation(error)) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message:
            'An account with this email already exists. Please sign in instead.',
        });
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------------------

  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthSession> {
    const email = this.normalizeEmail(dto.email);
    const identifier = `email:${email}`;

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: USER_LOGIN_SELECT,
    });

    // Always perform a password-hash comparison so account existence cannot
    // be inferred from a measurable response-time difference.
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.password ?? UNKNOWN_ACCOUNT_PASSWORD_HASH,
    );

    if (user && !user.password) {
      this.fireAndForget(
        this.accountLockService.recordFailedAttempt(identifier),
        'failed login attempt (oauth account)',
      );
      throw new UnauthorizedException(
        'This account was registered with Google Sign-In. Please sign in with Google.',
      );
    }

    if (!user || !passwordMatches) {
      this.fireAndForget(
        this.accountLockService.recordFailedAttempt(identifier),
        'failed login attempt',
      );

      this.fireAndForget(
        this.auditLog.log({
          action: 'USER_LOGIN_FAILED',
          entity: 'User',
          entityId: user?.id,
          payload: { credentialType: 'email' },
          ipAddress,
          userAgent,
        }),
        'failed-login audit log',
      );

      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      if (user.deactivatedBy) {
        const suspension = parseSuspension(
          user.deactivationReason,
          user.deactivatedBy,
        );

        if (suspension.isExpired) {
          // Automatic unsuspend because the suspension duration has elapsed
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              isActive: true,
              deactivatedAt: null,
              deactivatedBy: null,
              deactivationReason: null,
              tokenVersion: { increment: 1 },
            },
          });

          this.fireAndForget(
            this.auditLog.log({
              action: 'USER_AUTO_UNSUSPEND_EXPIRED',
              entity: 'User',
              entityId: user.id,
              userId: user.id,
              payload: {
                reason: suspension.reason,
                expiredAt: suspension.suspendedUntil?.toISOString() ?? null,
              },
              ipAddress,
              userAgent,
            }),
            'auto-unsuspend audit log',
          );
        } else {
          const dateStr = suspension.suspendedUntil
            ? new Date(suspension.suspendedUntil).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : null;

          const detailMsg = dateStr
            ? `Your account has been suspended until ${dateStr}. Reason: "${suspension.reason}". Please contact support if you need assistance.`
            : `Your account has been suspended indefinitely. Reason: "${suspension.reason}". Please contact support if you need assistance.`;

          throw new UnauthorizedException({
            message: detailMsg,
            code: 'ACCOUNT_SUSPENDED',
            reason: suspension.reason,
            suspendedUntil: suspension.suspendedUntil?.toISOString() ?? null,
            isIndefinite: suspension.isIndefinite,
          });
        }
      } else {
        throw new UnauthorizedException('ACCOUNT_DEACTIVATED');
      }
    }

    this.fireAndForget(
      this.accountLockService.resetAttempts(identifier),
      'reset login attempts',
    );

    if (user.password && bcrypt.getRounds(user.password) < BCRYPT_COST_FACTOR) {
      void this.upgradePasswordHash(user.id, user.password, dto.password);
    }

    const session = await this.refreshSessionService.issueUserSession(user);

    this.fireAndForget(
      this.auditLog.log({
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        payload: { role: user.role },
        ipAddress,
        userAgent,
      }),
      'login audit log',
    );

    return session;
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // GOOGLE OAUTH
  // ---------------------------------------------------------------------------

  async googleAuth(
    dto: GoogleAuthDto,
    ipAddress?: string,
    userAgent?: string,
    intent: 'login' | 'signup' = 'signup',
  ): Promise<AuthSession> {
    if (!this.googleAuthService) {
      throw new InternalServerErrorException(
        'Google authentication service is not configured',
      );
    }

    const payload = await this.googleAuthService.verifyIdToken(dto.idToken);
    const identifier = `email:${payload.email}`;
    const accountExistsError = () =>
      new ConflictException({
        code: 'GOOGLE_ACCOUNT_EXISTS',
        message:
          'An account with this Google email already exists. Please sign in instead.',
      });

    // 1. Check if user already exists by googleId
    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: payload.googleId },
      select: USER_LOGIN_SELECT,
    });

    if (existingByGoogleId && intent === 'signup') {
      throw accountExistsError();
    }

    if (existingByGoogleId) {
      await this.assertAccountIsActive(
        existingByGoogleId,
        ipAddress,
        userAgent,
      );

      this.fireAndForget(
        this.accountLockService.resetAttempts(identifier),
        'reset login attempts',
      );

      const session =
        await this.refreshSessionService.issueUserSession(existingByGoogleId);

      this.fireAndForget(
        this.auditLog.log({
          action: 'USER_GOOGLE_LOGIN',
          entity: 'User',
          entityId: existingByGoogleId.id,
          userId: existingByGoogleId.id,
          payload: { role: existingByGoogleId.role, authProvider: 'GOOGLE' },
          ipAddress,
          userAgent,
        }),
        'google login audit log',
      );

      return session;
    }

    // 2. Check if user already exists by email
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: payload.email },
      select: USER_LOGIN_SELECT,
    });

    if (existingByEmail && intent === 'signup') {
      throw accountExistsError();
    }

    if (existingByEmail) {
      await this.assertAccountIsActive(existingByEmail, ipAddress, userAgent);

      // Link googleId to existing verified account
      const linkedUser = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: payload.googleId,
          avatarUrl: existingByEmail.avatarUrl ?? payload.avatarUrl,
          isEmailVerified: true,
        },
        select: USER_LOGIN_SELECT,
      });

      this.fireAndForget(
        this.accountLockService.resetAttempts(identifier),
        'reset login attempts',
      );

      const session =
        await this.refreshSessionService.issueUserSession(linkedUser);

      this.fireAndForget(
        this.auditLog.log({
          action: 'USER_GOOGLE_ACCOUNT_LINKED',
          entity: 'User',
          entityId: linkedUser.id,
          userId: linkedUser.id,
          payload: {
            role: linkedUser.role,
            previousProvider: existingByEmail.authProvider,
          },
          ipAddress,
          userAgent,
        }),
        'google account link audit log',
      );

      return session;
    }

    if (intent === 'login') {
      throw new UnauthorizedException({
        code: 'GOOGLE_ACCOUNT_NOT_FOUND',
        message:
          'No customer account is associated with this Google account. Please sign up first.',
      });
    }

    // 3. User does not exist: create user with Google profile in transaction
    const referral = dto.referralCode
      ? await this.referralService.validateReferralCode(
          dto.referralCode,
          payload.email,
        )
      : null;

    const newUser = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: payload.email,
            password: null,
            firstName: payload.firstName,
            lastName: payload.lastName,
            googleId: payload.googleId,
            authProvider: 'GOOGLE',
            avatarUrl: payload.avatarUrl,
            isEmailVerified: true,
          },
          select: USER_AUTH_SELECT,
        });

        await tx.userWallet.create({
          data: {
            userId: created.id,
          },
        });

        await this.referralService.createReferralCode(tx, created.id);

        if (referral) {
          await this.referralService.applyReferralAtSignupById(
            tx,
            created.id,
            referral.id,
            referral.userId,
          );
        }

        return created;
      })
      .catch((error: unknown) => {
        if (
          this.isUserEmailUniqueViolation(error) ||
          this.isUserGoogleIdUniqueViolation(error)
        ) {
          throw accountExistsError();
        }
        throw error;
      });

    const session = await this.refreshSessionService.issueUserSession(newUser);

    this.fireAndForget(
      this.auditLog.log({
        action: 'USER_GOOGLE_REGISTER',
        entity: 'User',
        entityId: newUser.id,
        userId: newUser.id,
        payload: { authProvider: 'GOOGLE' },
        ipAddress,
        userAgent,
      }),
      'google registration audit log',
    );

    this.fireAndForget(
      this.emailService.sendWelcomeEmail(payload.email, payload.firstName),
      'welcome email',
    );

    return session;
  }

  private async assertAccountIsActive(
    user: {
      id: string;
      isActive: boolean;
      deactivatedBy?: string | null;
      deactivationReason?: string | null;
      tokenVersion?: number;
    },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    if (user.isActive) return;

    if (user.deactivatedBy) {
      const suspension = parseSuspension(
        user.deactivationReason,
        user.deactivatedBy,
      );

      if (suspension.isExpired) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            isActive: true,
            deactivatedAt: null,
            deactivatedBy: null,
            deactivationReason: null,
            tokenVersion: { increment: 1 },
          },
        });

        this.fireAndForget(
          this.auditLog.log({
            action: 'USER_AUTO_UNSUSPEND_EXPIRED',
            entity: 'User',
            entityId: user.id,
            userId: user.id,
            payload: {
              reason: suspension.reason,
              expiredAt: suspension.suspendedUntil?.toISOString() ?? null,
            },
            ipAddress,
            userAgent,
          }),
          'auto-unsuspend audit log',
        );
        return;
      }

      const dateStr = suspension.suspendedUntil
        ? new Date(suspension.suspendedUntil).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : null;

      const detailMsg = dateStr
        ? `Your account has been suspended until ${dateStr}. Reason: "${suspension.reason}". Please contact support if you need assistance.`
        : `Your account has been suspended indefinitely. Reason: "${suspension.reason}". Please contact support if you need assistance.`;

      throw new UnauthorizedException({
        message: detailMsg,
        code: 'ACCOUNT_SUSPENDED',
        reason: suspension.reason,
        suspendedUntil: suspension.suspendedUntil?.toISOString() ?? null,
        isIndefinite: suspension.isIndefinite,
      });
    }

    throw new UnauthorizedException('ACCOUNT_DEACTIVATED');
  }

  // REFRESH
  // ---------------------------------------------------------------------------

  async refresh(payload: RefreshJwtPayload): Promise<AuthSession> {
    return this.refreshSessionService.refresh(payload);
  }

  // ---------------------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------------------

  async logout(
    userId: string,
    role: ROLE = ROLE.USER,
    sessionId?: string,
    refreshToken?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    if (role === ROLE.USER) {
      if (sessionId) {
        await this.refreshSessionService.revokeUserSession(userId, sessionId);
      } else if (refreshToken) {
        await this.refreshSessionService.revokeUserSessionByRefreshToken(
          userId,
          refreshToken,
        );
      }
    } else {
      await this.refreshSessionService.revokeSession(userId, role, true);
    }

    this.fireAndForget(
      this.auditLog.log({
        action: 'USER_LOGOUT',
        entity: 'User',
        entityId: userId,
        userId,
        ipAddress,
        userAgent,
      }),
      'logout audit log',
    );
  }

  async logoutAll(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.refreshSessionService.revokeAllUserSessions(userId);

    this.fireAndForget(
      this.auditLog.log({
        action: 'USER_LOGOUT_ALL',
        entity: 'User',
        entityId: userId,
        userId,
        ipAddress,
        userAgent,
      }),
      'logout-all audit log',
    );
  }

  // ---------------------------------------------------------------------------
  // OTP
  // ---------------------------------------------------------------------------

  async requestRegistrationOtp(dto: RequestOtpDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (user) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_EXISTS',
        message:
          'An account with this email already exists. Please sign in instead.',
      });
    }

    await this.otpService.createOtp(email, 'registration');
  }

  async verifyRegistrationOtp(
    dto: VerifyOtpDto,
  ): Promise<VerifyOtpResponseDto> {
    const email = this.normalizeEmail(dto.email);
    await this.otpService.verifyRegistrationOtp(email, dto.otpCode);
    return { verified: true };
  }

  async requestPasswordResetOtp(dto: RequestOtpDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return;
    }

    await this.otpService.createOtp(email, 'password-reset');
  }

  // ---------------------------------------------------------------------------
  // PASSWORD RESET
  // ---------------------------------------------------------------------------

  async resetPassword(
    dto: ResetPasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const email = this.normalizeEmail(dto.email);

    await this.otpService.verifyOtp(email, dto.otpCode, 'password-reset');

    const password = await bcrypt.hash(dto.newPassword, BCRYPT_COST_FACTOR);

    try {
      const user = await this.prisma.user.update({
        where: { email },
        data: {
          password,
        },
        select: {
          id: true,
          firstName: true,
        },
      });

      // Revoke ALL sessions atomically (UserAuthSession + account-level tokens + Redis stamp)
      await this.refreshSessionService.revokeAllUserSessions(user.id);

      this.fireAndForget(
        this.auditLog.log({
          action: 'USER_RESET_PASSWORD',
          entity: 'User',
          entityId: user.id,
          userId: user.id,
          ipAddress,
          userAgent,
        }),
        'password-reset audit log',
      );

      this.fireAndForget(
        this.emailService.sendPasswordResetSuccessEmail(
          email,
          user.firstName ?? '',
        ),
        'password-reset confirmation email',
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new UnauthorizedException('Invalid password reset request');
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // PASSWORD HASH
  // ---------------------------------------------------------------------------

  private async upgradePasswordHash(
    userId: string,
    oldHash: string,
    password: string,
  ): Promise<void> {
    try {
      const newHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

      await this.prisma.user.updateMany({
        where: {
          id: userId,
          password: oldHash,
        },
        data: {
          password: newHash,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to upgrade password hash', error);
    }
  }

  async getProfile(user: AuthenticatedUser) {
    if (user.role === ROLE.VENDOR) {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          storeName: true,
          storeSlug: true,
          storeDescription: true,
          storeLogoUrl: true,
          isVerified: true,
          isActive: true,
          isApproved: true,
        },
      });
      if (!vendor) throw new UnauthorizedException('Vendor profile not found');
      return {
        ...vendor,
        role: 'vendor' as const,
        capabilities: {
          canSell: Boolean(vendor.isApproved && vendor.isActive),
        },
      };
    }

    if (user.role === ROLE.ADMIN) {
      const admin = await this.prisma.admin.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      });
      if (!admin) throw new UnauthorizedException('Admin profile not found');
      return {
        ...admin,
        role: 'admin' as const,
        capabilities: {
          canAdminister: Boolean(admin.isActive),
        },
      };
    }

    const customer = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
      },
    });
    if (!customer) throw new UnauthorizedException('User profile not found');
    return {
      ...customer,
      role: 'user' as const,
      capabilities: {
        canPurchase: Boolean(customer.isActive),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUserEmailUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];

    return fields.some((field) => field.toLowerCase().includes('email'));
  }

  private isUserGoogleIdUniqueViolation(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];

    return fields.some((field) => field.toLowerCase().includes('googleid'));
  }

  private fireAndForget(promise: Promise<unknown>, operation: string): void {
    void promise.catch((error) => {
      this.logger.warn(`Failed to execute ${operation}`, error);
    });
  }
}
