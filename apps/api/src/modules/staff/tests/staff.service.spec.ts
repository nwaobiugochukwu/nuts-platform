import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StaffService } from '../services/staff.service';
import { captureAudit } from '@api/modules/audit/audit-testing-spec';

describe('StaffService', () => {
  let service: StaffService;
  let mockPrisma: any;

  const baseAdmin = {
    id: 'admin-1',
    email: 'ops@nuts.dev',
    role: 'ADMIN',
    isActive: true,
    firstName: 'System',
    lastName: 'Admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      admin: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    service = new StaffService(mockPrisma);
  });

  describe('getStaffList()', () => {
    it('returns paginated admin staff members', async () => {
      mockPrisma.admin.findMany.mockResolvedValue([baseAdmin]);
      mockPrisma.admin.count.mockResolvedValue(1);

      const result = await service.getStaffList({ page: 1, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].email).toBe('ops@nuts.dev');
    });
  });

  describe('createStaff()', () => {
    it('creates a new admin staff member with hashed password', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue(null);
      mockPrisma.admin.create.mockResolvedValue({
        ...baseAdmin,
        id: 'new-admin-2',
        email: 'staff2@nuts.dev',
      });

      const { result: res, details } = await captureAudit(() =>
        service.createStaff({
          email: 'staff2@nuts.dev',
          password: 'SuperPassword123!',
          firstName: 'New',
          lastName: 'Staff',
        }),
      );

      expect(mockPrisma.admin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'staff2@nuts.dev',
            role: 'ADMIN',
          }),
        }),
      );
      expect(res.email).toBe('staff2@nuts.dev');
      expect(details).toMatchObject({
        payload: { email: 'staff2@nuts.dev', role: 'ADMIN' },
      });
    });

    it('throws ConflictException if admin email already exists', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue(baseAdmin);

      await expect(
        service.createStaff({
          email: 'ops@nuts.dev',
          password: 'SuperPassword123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateStaffStatus()', () => {
    it('prevents an admin from deactivating their own account', async () => {
      await expect(
        service.updateStaffStatus('admin-1', { isActive: false }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if target admin does not exist', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStaffStatus('admin-999', { isActive: false }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deactivates staff member and increments tokenVersion to revoke active sessions', async () => {
      mockPrisma.admin.findUnique.mockResolvedValue(baseAdmin);
      mockPrisma.admin.update.mockResolvedValue({
        ...baseAdmin,
        isActive: false,
      });

      const updated = await service.updateStaffStatus(
        'admin-target',
        { isActive: false },
        'admin-1',
      );

      expect(mockPrisma.admin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
            refreshToken: null,
            tokenVersion: { increment: 1 },
          }),
        }),
      );
      expect(updated.isActive).toBe(false);
    });
  });
});
