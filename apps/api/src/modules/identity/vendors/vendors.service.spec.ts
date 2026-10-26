import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { VendorsService } from './vendors.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import { EmailService } from '@api/modules/infrastructure/mail/email.service';
import { AuditLogService } from '@api/modules/shared/audit-log/audit-log.service';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';

describe('VendorsService', () => {
  let service: VendorsService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockConfig: any;
  let mockOtp: any;
  let mockEmail: any;
  let mockAudit: any;
  let mockCache: any;
  let mockAccountLock: any;

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
  };

  beforeEach(() => {
    mockPrisma = {
      vendor: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) =>
        fn(mockPrisma),
      ),
    };

    // Use signAsync — the services call jwtService.signAsync, not .sign
    mockJwt = {
      signAsync: jest.fn().mockResolvedValue('signed-access-token'),
    };

    mockConfig = {
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          JWT_SECRET: 'secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
          JWT_ISSUER: 'nuts-api',
          JWT_ACCESS_AUDIENCE: 'nuts-app',
          JWT_REFRESH_AUDIENCE: 'nuts-refresh',
          JWT_REFRESH_SECRET: 'refresh-secret',
          BCRYPT_COST_FACTOR: '12',
        };
        return map[key] ?? '';
      }),
      get: jest.fn().mockReturnValue(undefined),
    };

    mockOtp = {
      verifyOtp: jest.fn().mockResolvedValue(undefined),
    };

    mockEmail = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendVendorApplicationReceivedEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendVendorApprovedEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockCache = {
      del: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      wrapStale: jest.fn(
        (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
      ),
    };

    mockAccountLock = {
      recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
      resetAttempts: jest.fn().mockResolvedValue(undefined),
    };

    const mockRefreshSession = {
      issueVendorSession: jest.fn().mockResolvedValue({
        user: { id: 'v1', email: 'shop@nuts.dev' },
        tokens: { accessToken: 'at', refreshToken: 'rt', refreshId: 'rid' },
      }),
      refresh: jest.fn().mockResolvedValue({
        user: { id: 'v1', email: 'shop@nuts.dev' },
        tokens: { accessToken: 'at', refreshToken: 'rt', refreshId: 'rid' },
      }),
      revokeSession: jest.fn().mockResolvedValue(undefined),
    };

    service = new VendorsService(
      mockPrisma,
      mockOtp,
      mockEmail,
      mockAudit,
      mockCache,
      mockAccountLock,
      mockRefreshSession as any,
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
      // storeRefreshToken calls vendor.update
      mockPrisma.vendor.update.mockResolvedValue({
        ...baseVendorRecord,
        refreshToken: 'hashed-refresh',
        refreshTokenId: 'ref-1',
      });

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
      expect(result.tokens).toBeDefined();
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
        'email:unknown@test.com',
      );
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
        refreshToken: null,
        refreshTokenId: null,
      });
      mockPrisma.vendor.update.mockResolvedValue({
        ...baseVendorRecord,
        refreshToken: 'hashed',
        refreshTokenId: 'ref-1',
      });

      const result = await service.login({
        email: 'shop@nuts.dev',
        password: 'StrongPass1!',
      });

      expect(mockAccountLock.resetAttempts).toHaveBeenCalledWith(
        'email:shop@nuts.dev',
      );
      expect(result.tokens).toBeDefined();
    });
  });

  // ===========================================================================
  // PROFILE UPDATE
  // ===========================================================================
  describe('updateProfile()', () => {
    it('converts P2002 to ConflictException when updated store slug is already taken', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(baseVendorRecord);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint on storeSlug',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      mockPrisma.vendor.update.mockRejectedValue(p2002);

      await expect(
        service.updateProfile('vendor-1', { storeName: 'Existing Store' }),
      ).rejects.toThrow(ConflictException);
    });

    it('invalidates both old and new store slug cache keys when store name changes', async () => {
      const updatedVendor = {
        ...baseVendorRecord,
        storeName: 'New Store',
        storeSlug: 'new-store',
      };
      mockPrisma.vendor.findUnique.mockResolvedValue(baseVendorRecord);
      mockPrisma.vendor.update.mockResolvedValue(updatedVendor);

      await service.updateProfile('vendor-1', { storeName: 'New Store' });

      expect(mockCache.del).toHaveBeenCalledWith(
        expect.stringContaining('nuts-store'),
      );
      expect(mockCache.del).toHaveBeenCalledWith(
        expect.stringContaining('new-store'),
      );
    });
  });

  // ===========================================================================
  // DEACTIVATE
  // ===========================================================================
  describe('deactivateProfile()', () => {
    it('revokes vendor session tokens and increments tokenVersion to invalidate all active JWTs', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(baseVendorRecord);
      mockPrisma.vendor.update.mockResolvedValue({
        ...baseVendorRecord,
        isActive: false,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: 2,
      });

      await service.deactivateProfile('vendor-1');

      expect(mockPrisma.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
            refreshToken: null,
            refreshTokenId: null,
            tokenVersion: { increment: 1 },
          }),
        }),
      );
      expect(mockCache.del).toHaveBeenCalled();
    });
  });
});
