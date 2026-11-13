import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { VendorAuthService } from './vendor-auth.service';

describe('VendorAuthService', () => {
  let service: VendorAuthService;
  let mockPrisma: any;
  let mockOtp: any;
  let mockEmail: any;
  let mockAudit: any;
  let mockAccountLock: any;
  let mockRefreshSession: any;
  let mockGoogleAuth: any;

  const baseVendorRecord = {
    id: 'vendor-1',
    email: 'shop@nuts.dev',
    storeName: 'Nuts Store',
    storeSlug: 'nuts-store',
    storeDescription: 'The freshest nuts',
    businessPhone: '+234800000001',
    businessEmail: 'biz@nuts.dev',
    storeLogoUrl: null,
    storeLogoAltText: null,
    isVerified: false,
    isActive: true,
    isApproved: true,
    firstName: 'Ada',
    lastName: 'Obi',
    phone: '+234800000001',
    tokenVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    password: '$2b$12$hashedpassword',
    avatarUrl: null,
    authProvider: 'LOCAL',
  };

  beforeEach(() => {
    mockPrisma = {
      vendor: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockOtp = {
      verifyOtp: jest.fn().mockResolvedValue(undefined),
    };

    mockEmail = {
      sendVendorApplicationReceivedEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendPasswordResetSuccessEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockAccountLock = {
      recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
      resetAttempts: jest.fn().mockResolvedValue(undefined),
    };

    mockRefreshSession = {
      issueVendorSession: jest.fn().mockResolvedValue({
        tokens: { accessToken: 'at', refreshToken: 'rt', refreshId: 'rid' },
      }),
      refresh: jest.fn().mockResolvedValue({
        tokens: { accessToken: 'at', refreshToken: 'rt', refreshId: 'rid' },
      }),
      revokeSession: jest.fn().mockResolvedValue(undefined),
    };

    mockGoogleAuth = {
      verifyIdToken: jest.fn(),
    };

    service = new VendorAuthService(
      mockPrisma,
      mockOtp,
      mockEmail,
      mockAudit,
      mockAccountLock,
      mockRefreshSession,
      mockGoogleAuth,
    );
  });

  // ===========================================================================
  // REGISTER
  // ===========================================================================
  describe('register()', () => {
    const dto = {
      email: 'Shop@Nuts.DEV ',
      password: 'StrongPass1!',
      storeName: 'Nuts Store',
      storeDescription: 'Fresh nuts daily',
      businessPhone: '+234800000001',
      otpCode: '123456',
    };

    it('registers a new vendor and creates vendorWallet atomically in the same DB write', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue(null);
      mockPrisma.vendor.create.mockResolvedValue(baseVendorRecord);

      const result = await service.register(dto);

      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(
        'shop@nuts.dev',
        '123456',
        'vendor:registration',
      );
      expect(mockPrisma.vendor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'shop@nuts.dev',
            storeName: 'Nuts Store',
            vendorWallet: { create: {} },
          }),
        }),
      );
      expect(result.profile.email).toBe('shop@nuts.dev');
      expect(result.tokens).toBeNull(); // Pending approval vendors don't receive tokens
    });

    it('throws ConflictException when email or store slug already exists (pre-check)', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue({ id: 'existing-vendor' });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.vendor.create).not.toHaveBeenCalled();
    });

    it('converts P2002 race condition to ConflictException when two registrations collide', async () => {
      mockPrisma.vendor.findFirst.mockResolvedValue(null);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on (email)',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      mockPrisma.vendor.create.mockRejectedValue(p2002);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when storeName produces an empty slug', async () => {
      await expect(
        service.register({ ...dto, storeName: '   ---   ' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // LOGIN
  // ===========================================================================
  describe('login()', () => {
    it('performs timing-safe bcrypt comparison and records failed attempt for unknown email', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAccountLock.recordFailedAttempt).toHaveBeenCalledWith(
        'vendor:unknown@test.com',
      );
    });

    it('rejects login with helpful error when vendor signed up with Google (no password)', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        password: null,
      });

      await expect(
        service.login({ email: 'shop@nuts.dev', password: 'AnyPassword123!' }),
      ).rejects.toThrow('This vendor account was created with Google Sign-In');
    });

    it('rejects login for a deactivated vendor even with correct password', async () => {
      const hashedPassword = await bcrypt.hash('StrongPass1!', 10);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        isActive: false,
        password: hashedPassword,
      });

      await expect(
        service.login({ email: 'shop@nuts.dev', password: 'StrongPass1!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects login for an unapproved vendor account', async () => {
      const hashedPassword = await bcrypt.hash('StrongPass1!', 10);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        isApproved: false,
        password: hashedPassword,
      });

      await expect(
        service.login({ email: 'shop@nuts.dev', password: 'StrongPass1!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('resets failed attempt counter and issues tokens on successful login', async () => {
      const hashedPassword = await bcrypt.hash('StrongPass1!', 10);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        password: hashedPassword,
      });

      const result = await service.login({
        email: 'shop@nuts.dev',
        password: 'StrongPass1!',
      });

      expect(mockAccountLock.resetAttempts).toHaveBeenCalledWith(
        'vendor:shop@nuts.dev',
      );
      expect(result.tokens).toBeDefined();
    });
  });

  // ===========================================================================
  // GOOGLE AUTH
  // ===========================================================================
  describe('googleAuth()', () => {
    const googleDto = {
      idToken: 'vendor-google-id-token',
    };

    const googlePayload = {
      googleId: 'v-google-sub-1',
      email: 'vendor.google@example.com',
      firstName: 'Vendor',
      lastName: 'Owner',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.jpg',
      emailVerified: true,
    };

    it('authenticates approved existing vendor by googleId', async () => {
      mockGoogleAuth.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        googleId: 'v-google-sub-1',
        isApproved: true,
        isActive: true,
      });

      const res = await service.googleAuth(
        googleDto,
        undefined,
        undefined,
        'login',
      );

      expect(mockGoogleAuth.verifyIdToken).toHaveBeenCalledWith(
        'vendor-google-id-token',
      );
      expect(res.tokens).toBeDefined();
      expect(res.profile.email).toBe('shop@nuts.dev');
    });

    it('rejects login for unapproved vendor account', async () => {
      mockGoogleAuth.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        ...baseVendorRecord,
        googleId: 'v-google-sub-1',
        isApproved: false,
        isActive: true,
      });

      await expect(
        service.googleAuth(googleDto, undefined, undefined, 'login'),
      ).rejects.toThrow('Vendor account is not approved yet');
    });

    it('registers new vendor with store details via Google', async () => {
      mockGoogleAuth.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.vendor.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      mockPrisma.vendor.create.mockResolvedValue({
        ...baseVendorRecord,
        id: 'new-v-1',
        email: 'vendor.google@example.com',
        storeName: 'Google Tech Shop',
        storeSlug: 'google-tech-shop',
        googleId: 'v-google-sub-1',
        authProvider: 'GOOGLE',
        isApproved: false,
      });

      const res = await service.googleAuth(
        {
          ...googleDto,
          storeName: 'Google Tech Shop',
        },
        undefined,
        undefined,
        'signup',
      );

      expect(mockPrisma.vendor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'vendor.google@example.com',
            googleId: 'v-google-sub-1',
            authProvider: 'GOOGLE',
            isApproved: false,
          }),
        }),
      );
      expect(res.tokens).toBeNull();
      expect(res.profile.storeName).toBe('Google Tech Shop');
    });

    it('throws BadRequestException if new vendor does not provide storeName', async () => {
      mockGoogleAuth.verifyIdToken.mockResolvedValue(googlePayload);
      mockPrisma.vendor.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.googleAuth(googleDto, undefined, undefined, 'signup'),
      ).rejects.toThrow('storeName is required');
    });
  });

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  describe('logout()', () => {
    it('revokes vendor session in RefreshSessionService and logs audit', async () => {
      await service.logout('vendor-1');

      expect(mockRefreshSession.revokeSession).toHaveBeenCalledWith(
        'vendor-1',
        'VENDOR',
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VENDOR_LOGOUT',
          entityId: 'vendor-1',
        }),
      );
    });
  });
});
