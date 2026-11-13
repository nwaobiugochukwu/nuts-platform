import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  let service: VendorsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockCache: any;

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
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      category: {
        findMany: jest.fn(),
      },
      $queryRaw: jest.fn(),
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

    service = new VendorsService(mockPrisma, mockAudit, mockCache);
  });

  // ===========================================================================
  // GET PROFILE
  // ===========================================================================
  describe('getProfile()', () => {
    it('returns vendor profile when vendor exists', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(baseVendorRecord);

      const profile = await service.getProfile('vendor-1');

      expect(mockPrisma.vendor.findUnique).toHaveBeenCalledWith({
        where: { id: 'vendor-1' },
        select: expect.any(Object),
      });
      expect(profile.id).toBe('vendor-1');
      expect(profile.email).toBe('shop@nuts.dev');
    });

    it('throws NotFoundException when vendor does not exist', async () => {
      mockPrisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('vendor-nonexistent')).rejects.toThrow(
        NotFoundException,
      );
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

  // ===========================================================================
  // REACTIVATE
  // ===========================================================================
  describe('reactivate()', () => {
    it('reactivates deactivated vendor when valid credentials supplied', async () => {
      const hashedPassword = await bcrypt.hash('SecretPass1!', 10);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        id: 'vendor-1',
        password: hashedPassword,
        isActive: false,
        storeName: 'Nuts Store',
        storeSlug: 'nuts-store',
        isApproved: true,
      });
      mockPrisma.vendor.update.mockResolvedValue({
        ...baseVendorRecord,
        isActive: true,
      });

      const res = await service.reactivate({
        email: 'shop@nuts.dev',
        password: 'SecretPass1!',
      });

      expect(res.isActive).toBe(true);
      expect(mockPrisma.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vendor-1' },
          data: expect.objectContaining({
            isActive: true,
            deactivatedAt: null,
          }),
        }),
      );
    });

    it('rejects reactivation with UnauthorizedException on incorrect password', async () => {
      const hashedPassword = await bcrypt.hash('SecretPass1!', 10);
      mockPrisma.vendor.findUnique.mockResolvedValue({
        id: 'vendor-1',
        password: hashedPassword,
        isActive: false,
        storeName: 'Nuts Store',
        storeSlug: 'nuts-store',
        isApproved: true,
      });

      await expect(
        service.reactivate({
          email: 'shop@nuts.dev',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ===========================================================================
  // DELETE PROFILE
  // ===========================================================================
  describe('deleteProfile()', () => {
    it('deletes vendor and invalidates store caches', async () => {
      mockPrisma.vendor.delete.mockResolvedValue({
        id: 'vendor-1',
        email: 'shop@nuts.dev',
        storeName: 'Nuts Store',
        storeSlug: 'nuts-store',
      });

      await service.deleteProfile('vendor-1');

      expect(mockPrisma.vendor.delete).toHaveBeenCalledWith({
        where: { id: 'vendor-1' },
        select: expect.any(Object),
      });
      expect(mockCache.del).toHaveBeenCalled();
    });

    it('throws NotFoundException if vendor does not exist', async () => {
      const p2025 = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '7.8.0',
      });
      mockPrisma.vendor.delete.mockRejectedValue(p2025);

      await expect(service.deleteProfile('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
