import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import { AuditLogService } from '@api/modules/shared/audit-log/audit-log.service';
import { AdminVendorsService } from '../manage-vendors/admin-vendors.service';

const p2025 = () =>
  new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '7.8.0',
  });

// ─── AdminAuthService ────────────────────────────────────────────────────────

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockAudit: any;
  let mockAccountLock: any;

  const baseAdmin = {
    id: 'admin-1',
    email: 'admin@nuts.dev',
    firstName: 'Super',
    lastName: 'Admin',
    isActive: true,
    tokenVersion: 1,
  };

  beforeEach(() => {
    mockPrisma = {
      admin: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(baseAdmin),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) =>
        fn(mockPrisma),
      ),
    };

    mockConfig = {
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          JWT_SECRET: 'secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
          JWT_ISSUER: 'nuts-api',
          JWT_ACCESS_AUDIENCE: 'nuts-app',
          JWT_REFRESH_AUDIENCE: 'nuts-refresh',
        };
        return map[key] ?? 'x';
      }),
      get: jest.fn((key: string) =>
        key === 'ADMIN_SETUP_SECRET' ? 'super-secret-setup' : undefined,
      ),
    };

    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockAccountLock = {
      recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
      resetAttempts: jest.fn().mockResolvedValue(undefined),
    };

    const mockRefreshSession = {
      issueAdminSession: jest.fn().mockResolvedValue({
        user: {
          id: 'admin-1',
          email: 'admin@nuts.dev',
          firstName: 'Admin',
          lastName: 'User',
        },
        tokens: {
          accessToken: 'signed-jwt',
          refreshToken: 'refresh-jwt',
          refreshId: 'rid',
        },
      }),
      refresh: jest.fn().mockResolvedValue({
        user: {
          id: 'admin-1',
          email: 'admin@nuts.dev',
          firstName: 'Admin',
          lastName: 'User',
        },
        tokens: {
          accessToken: 'signed-jwt',
          refreshToken: 'refresh-jwt',
          refreshId: 'rid',
        },
      }),
      revokeSession: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminAuthService(
      mockPrisma,
      mockConfig,
      mockAudit,
      mockAccountLock,
      mockRefreshSession as any,
    );
  });

  describe('login()', () => {
    it('runs a dummy bcrypt compare and records a failed attempt for an unknown admin', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@nuts.dev', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAccountLock.recordFailedAttempt).toHaveBeenCalledWith(
        'email:ghost@nuts.dev',
      );
    });

    it('records a failed attempt for a valid email with the wrong password', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue({
        ...baseAdmin,
        password: await bcrypt.hash('RealPassword!1', 4),
      });

      await expect(
        service.login({ email: 'admin@nuts.dev', password: 'WrongPass!' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockAccountLock.recordFailedAttempt).toHaveBeenCalled();
    });

    it('rejects a deactivated admin even with the correct password', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue({
        ...baseAdmin,
        isActive: false,
        password: await bcrypt.hash('RealPassword!1', 4),
      });

      await expect(
        service.login({ email: 'admin@nuts.dev', password: 'RealPassword!1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // REGRESSION: lookup used the raw email while setup() stores it lowercased.
    it('normalizes email casing/whitespace before the DB lookup', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue({
        ...baseAdmin,
        password: await bcrypt.hash('RealPassword!1', 4),
      });

      await service.login({
        email: '  Admin@NUTS.dev ',
        password: 'RealPassword!1',
      });

      expect(mockPrisma.admin.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'admin@nuts.dev' } }),
      );
    });

    it('resets the lockout counter and issues both tokens on success', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue({
        ...baseAdmin,
        password: await bcrypt.hash('RealPassword!1', 4),
      });

      const result = await service.login({
        email: 'admin@nuts.dev',
        password: 'RealPassword!1',
      });

      expect(mockAccountLock.resetAttempts).toHaveBeenCalledWith(
        'email:admin@nuts.dev',
      );
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });
  });

  describe('setup() — one-time bootstrap', () => {
    const dto = {
      email: 'Admin@Nuts.dev',
      password: 'Pass1!Pass1!',
      setupSecret: 'super-secret-setup',
    };

    it('refuses setup when ADMIN_SETUP_SECRET is not configured', async () => {
      mockConfig.get.mockReturnValue(undefined);
      await expect(service.setup(dto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an incorrect setup secret', async () => {
      await expect(
        service.setup({ ...dto, setupSecret: 'WRONG' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.admin.create).not.toHaveBeenCalled();
    });

    it('rejects setup once an admin already exists', async () => {
      mockPrisma.admin.count.mockResolvedValue(1);
      await expect(service.setup(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.admin.create).not.toHaveBeenCalled();
    });

    it('maps a serialization failure (P2034) from concurrent setups to 409', async () => {
      mockPrisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('serialization', {
          code: 'P2034',
          clientVersion: '7.8.0',
        }),
      );
      await expect(service.setup(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the first admin with a normalized email and issues a session', async () => {
      mockPrisma.admin.count.mockResolvedValue(0);
      mockPrisma.admin.create.mockResolvedValue(baseAdmin);

      const result = await service.setup(dto);

      expect(mockPrisma.admin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'admin@nuts.dev' }),
        }),
      );
      expect(result.tokens).toBeDefined();
    });
  });
});

// ─── AdminVendorsService ─────────────────────────────────────────────────────

describe('AdminVendorsService', () => {
  let service: AdminVendorsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;

  const statusRow = {
    id: 'vendor-1',
    isActive: true,
    isApproved: true,
    isVerified: false,
    updatedAt: new Date(),
    email: 'shop@nuts.dev',
    storeName: 'Nuts Store',
    storeSlug: 'nuts-store',
    firstName: 'Ugo',
  };

  let mockEmailService: any;

  beforeEach(() => {
    mockPrisma = {
      vendor: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCache = {
      del: jest.fn().mockResolvedValue(undefined),
      delByPattern: jest.fn().mockResolvedValue(undefined),
    };
    mockEmailService = {
      sendVendorApprovedEmail: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminVendorsService(
      mockPrisma,
      mockAudit,
      mockCache,
      mockEmailService,
    );
  });

  describe('findAll()', () => {
    it('issues count + page query in parallel and returns pagination meta', async () => {
      mockPrisma.vendor.count.mockResolvedValue(1);
      mockPrisma.vendor.findMany.mockResolvedValue([
        {
          ...statusRow,
          storeDescription: '',
          businessPhone: '',
          businessEmail: '',
          storeLogoUrl: null,
          storeLogoAltText: null,
          firstName: '',
          lastName: '',
          phone: '',
          createdAt: new Date(),
        },
      ]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(mockPrisma.vendor.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.vendor.findMany).toHaveBeenCalledTimes(1);
      expect(result.data).toHaveLength(1);
      expect(result.meta.totalItems).toBe(1);
    });

    it('uses a deterministic tiebreaker so pages never overlap', async () => {
      await service.findAll({});
      expect(mockPrisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('applies moderation filters and ignores whitespace-only search', async () => {
      await service.findAll({
        search: '   ',
        isActive: true,
        isApproved: false,
        isVerified: false,
      });

      const { where } = mockPrisma.vendor.findMany.mock.calls[0][0];
      // Whitespace-only search is trimmed to empty string, so no OR clause added
      expect(where).toEqual({
        isActive: true,
        isApproved: false,
        isVerified: false,
      });
    });
  });

  describe('findOne()', () => {
    it('throws 404 for an unknown vendor', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('status transitions', () => {
    it('approve(): sets the flag, writes an audit diff and evicts caches', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue({ isApproved: false });
      mockPrisma.vendor.update.mockResolvedValue(statusRow);

      const result = await service.approve('admin-1', 'vendor-1');

      expect(result.isApproved).toBe(true);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'APPROVE_VENDOR',
          adminId: 'admin-1',
        }),
      );
      expect(mockCache.del).toHaveBeenCalledWith('vendor:store:nuts-store:v2');
    });

    // REGRESSION: admin moderation previously never touched the cache, so a
    // deactivated vendor stayed publicly visible for up to 1h.
    it('deactivate(): revokes sessions atomically and evicts store + public list caches', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue({ isActive: true });
      mockPrisma.vendor.update.mockResolvedValue({
        ...statusRow,
        isActive: false,
      });

      await service.deactivate('admin-1', 'vendor-1');

      expect(mockPrisma.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            isActive: false,
            refreshToken: null,
            refreshTokenId: null,
            tokenVersion: { increment: 1 },
          },
        }),
      );
      expect(mockCache.del).toHaveBeenCalledWith('vendor:store:nuts-store:v2');
      expect(mockCache.del).toHaveBeenCalledWith(
        'vendor:store:nuts-store:products:v2',
      );
      expect(mockCache.delByPattern).toHaveBeenCalledWith('vendors:public:*');
      expect(mockCache.delByPattern).toHaveBeenCalledWith('products:public:*');
    });

    it('returns 404 (not 500) when the vendor does not exist', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.verify('admin-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.vendor.update).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('returns 404 when the vendor is deleted between read and write (P2025)', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue({
        isActive: false,
        isApproved: false,
        isVerified: false,
      });
      mockPrisma.vendor.update.mockRejectedValue(p2025());

      await expect(service.reactivate('admin-1', 'vendor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not fail the request if cache eviction throws (DB already committed)', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue({ isActive: true });
      mockPrisma.vendor.update.mockResolvedValue({
        ...statusRow,
        isActive: false,
      });
      mockCache.delByPattern.mockRejectedValue(new Error('redis down'));

      await expect(service.deactivate('admin-1', 'vendor-1')).resolves.toEqual(
        expect.objectContaining({ isActive: false }),
      );
      expect(mockAudit.log).toHaveBeenCalled();
    });
  });

  describe('delete()', () => {
    it('evicts caches and audits after a successful delete', async () => {
      mockPrisma.vendor.delete.mockResolvedValue(statusRow);

      await service.delete('admin-1', 'vendor-1');

      expect(mockCache.del).toHaveBeenCalledWith('vendor:store:nuts-store:v2');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE_VENDOR' }),
      );
    });

    it('maps P2025 to 404', async () => {
      mockPrisma.vendor.delete.mockRejectedValue(p2025());
      await expect(service.delete('admin-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
