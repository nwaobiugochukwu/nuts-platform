import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, ROLE } from '@prisma/client';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { ReferralService } from '@api/modules/referral/referral.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { RefreshSessionService } from './sessions/refresh-session.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockOtpService: any;
  let mockEmailService: any;
  let mockAuditLog: any;
  let mockReferralService: any;
  let mockAccountLockService: any;
  let mockRefreshSessionService: any;
  let mockGoogleAuthService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userWallet: {
        create: jest.fn(),
      },
      shippingAddress: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
        callback(mockPrisma),
      ),
    };
    mockOtpService = {
      verifyOtp: jest.fn().mockResolvedValue(true),
      consumeVerification: jest.fn().mockResolvedValue(false),
      verifyRegistrationOtp: jest.fn().mockResolvedValue(true),
      isOtpVerified: jest.fn().mockResolvedValue(false),
    };
    mockEmailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    mockAuditLog = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    mockReferralService = {
      validateReferralCode: jest.fn(),
      createReferralCode: jest.fn().mockResolvedValue({ id: 'ref-code-1' }),
      applyReferralAtSignupById: jest.fn().mockResolvedValue(undefined),
    };
    mockAccountLockService = {
      recordFailedAttempt: jest.fn().mockResolvedValue(1),
      resetAttempts: jest.fn().mockResolvedValue(undefined),
    };
    mockRefreshSessionService = {
      revokeSession: jest.fn().mockResolvedValue(undefined),
      revokeUserSession: jest.fn().mockResolvedValue(undefined),
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
      revokeUserSessionByRefreshToken: jest.fn().mockResolvedValue(undefined),
      issueUserSession: jest.fn().mockResolvedValue({
        tokens: {
          accessToken: 'access-jwt-token',
          refreshToken: 'refresh-jwt-token',
          refreshId: 'ref-1',
          expiresIn: 900,
          tokenType: 'Bearer',
        },
        user: { id: 'u-1', email: 'test@example.com' },
      }),
    };
    mockGoogleAuthService = {
      verifyIdToken: jest.fn(),
    };

    service = new AuthService(
      mockPrisma,
      mockOtpService,
      mockEmailService,
      mockAuditLog,
      mockReferralService,
      mockAccountLockService,
      mockRefreshSessionService,
      mockGoogleAuthService,
    );
  });

  describe('register', () => {
    const registerDto = {
      email: 'Test@Example.COM ',
      password: 'StrongPassword123!',
      firstName: 'John',
      lastName: 'Doe',
      otpCode: '123456',
    };
    it('creates user, wallet, and referral code in a single atomic transaction', async () => {
      const createdUser = {
        id: 'u-1',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        role: 'USER',
        isActive: true,
      };
      mockPrisma.user.create.mockResolvedValue(createdUser);

      const session = await service.register(registerDto);

      expect(mockOtpService.verifyOtp).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'registration',
      );
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            firstName: 'John',
            lastName: 'Doe',
          }),
        }),
      );
      expect(mockPrisma.userWallet.create).toHaveBeenCalledWith({
        data: { userId: 'u-1' },
      });
      expect(mockReferralService.createReferralCode).toHaveBeenCalledWith(
        mockPrisma,
        'u-1',
      );
      expect(session.tokens.accessToken).toBe('access-jwt-token');
    });

    it('throws ConflictException on unique email constraint violation (P2002)', async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on email',
        { code: 'P2002', clientVersion: '7.8.0', meta: { target: ['email'] } },
      );

      mockPrisma.user.create.mockRejectedValue(p2002Error);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    it('authenticates user with valid credentials and resets failed attempts', async () => {
      const hashedPassword = await bcrypt.hash('StrongPassword123!', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'test@example.com',
        password: hashedPassword,
        isActive: true,
        role: 'USER',
      });

      const session = await service.login({
        email: 'test@example.com',
        password: 'StrongPassword123!',
      });

      expect(session).toBeDefined();
      expect(mockAccountLockService.resetAttempts).toHaveBeenCalledWith(
        'email:test@example.com',
      );
      expect(mockRefreshSessionService.issueUserSession).toHaveBeenCalled();
    });

    it('performs timing-safe hash comparison and records failed attempt on invalid password', async () => {
      const hashedPassword = await bcrypt.hash('DifferentPassword', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'test@example.com',
        password: hashedPassword,
        isActive: true,
        role: 'USER',
      });

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAccountLockService.recordFailedAttempt).toHaveBeenCalledWith(
        'email:test@example.com',
      );
    });

    it('throws UnauthorizedException and protects against user enumeration when account does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'AnyPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAccountLockService.recordFailedAttempt).toHaveBeenCalledWith(
        'email:nonexistent@example.com',
      );
    });

    it('throws UnauthorizedException when account is deactivated', async () => {
      const hashedPassword = await bcrypt.hash('StrongPassword123!', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'test@example.com',
        password: hashedPassword,
        isActive: false, // Deactivated
        role: 'USER',
      });

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes only the current user device session', async () => {
      await service.logout('u-1', ROLE.USER, 'device-session-1');

      expect(mockRefreshSessionService.revokeUserSession).toHaveBeenCalledWith(
        'u-1',
        'device-session-1',
      );
      expect(mockRefreshSessionService.revokeSession).not.toHaveBeenCalled();
    });

    it('uses the verified legacy refresh cookie to revoke its migrated device session', async () => {
      await service.logout(
        'u-1',
        ROLE.USER,
        undefined,
        'signed-refresh-cookie',
      );

      expect(
        mockRefreshSessionService.revokeUserSessionByRefreshToken,
      ).toHaveBeenCalledWith('u-1', 'signed-refresh-cookie');
      expect(mockRefreshSessionService.revokeSession).not.toHaveBeenCalled();
    });

    it('retains account-wide revocation for the separate admin and vendor flows', async () => {
      await service.logout('admin-1', ROLE.ADMIN, undefined);

      expect(mockRefreshSessionService.revokeSession).toHaveBeenCalledWith(
        'admin-1',
        ROLE.ADMIN,
        true,
      );
      expect(
        mockRefreshSessionService.revokeUserSession,
      ).not.toHaveBeenCalled();
    });

    it('revokes all user sessions when logoutAll is invoked', async () => {
      await service.logoutAll('u-1');

      expect(
        mockRefreshSessionService.revokeAllUserSessions,
      ).toHaveBeenCalledWith('u-1');
    });
  });

  describe('googleAuth', () => {
    const googleDto = {
      idToken: 'valid-google-id-token',
    };

    const googlePayload = {
      googleId: 'google-sub-999',
      email: 'jane.google@example.com',
      firstName: 'Jane',
      lastName: 'Google',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      emailVerified: true,
    };

    it('authenticates an existing user by googleId directly', async () => {
      mockGoogleAuthService.verifyIdToken.mockResolvedValue(googlePayload);
      const existingUser = {
        id: 'user-google-1',
        email: 'jane.google@example.com',
        googleId: 'google-sub-999',
        role: ROLE.USER,
        isActive: true,
      };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const session = await service.googleAuth(
        googleDto,
        undefined,
        undefined,
        'login',
      );

      expect(mockGoogleAuthService.verifyIdToken).toHaveBeenCalledWith(
        'valid-google-id-token',
      );
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { googleId: 'google-sub-999' },
        select: expect.any(Object),
      });
      expect(mockRefreshSessionService.issueUserSession).toHaveBeenCalledWith(
        existingUser,
      );
      expect(session).toHaveProperty('tokens');
    });

    it('links googleId to an existing email account if not yet linked', async () => {
      mockGoogleAuthService.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'user-local-1',
          email: 'jane.google@example.com',
          googleId: null,
          authProvider: 'LOCAL',
          role: ROLE.USER,
          isActive: true,
          avatarUrl: null,
        });

      const linkedUser = {
        id: 'user-local-1',
        email: 'jane.google@example.com',
        googleId: 'google-sub-999',
        authProvider: 'LOCAL',
        role: ROLE.USER,
        isActive: true,
        avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      };
      mockPrisma.user.update.mockResolvedValue(linkedUser);

      const session = await service.googleAuth(
        googleDto,
        undefined,
        undefined,
        'login',
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-local-1' },
        data: expect.objectContaining({
          googleId: 'google-sub-999',
          isEmailVerified: true,
        }),
        select: expect.any(Object),
      });
      expect(session).toHaveProperty('tokens');
    });

    it('creates a new user, wallet, and referral code if user does not exist', async () => {
      mockGoogleAuthService.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const newUser = {
        id: 'new-user-1',
        email: 'jane.google@example.com',
        firstName: 'Jane',
        lastName: 'Google',
        googleId: 'google-sub-999',
        authProvider: 'GOOGLE',
        role: ROLE.USER,
        isActive: true,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);

      const session = await service.googleAuth(
        googleDto,
        undefined,
        undefined,
        'signup',
      );

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'jane.google@example.com',
          googleId: 'google-sub-999',
          authProvider: 'GOOGLE',
          password: null,
          isEmailVerified: true,
        }),
        select: expect.any(Object),
      });
      expect(mockPrisma.userWallet.create).toHaveBeenCalledWith({
        data: { userId: 'new-user-1' },
      });
      expect(mockReferralService.createReferralCode).toHaveBeenCalledWith(
        mockPrisma,
        'new-user-1',
      );
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'jane.google@example.com',
        'Jane',
      );
      expect(session).toHaveProperty('tokens');
    });
  });
});
