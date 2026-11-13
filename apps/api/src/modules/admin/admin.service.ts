import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import {
  AuditLogService,
  toAuditPayload,
} from '@api/common/audit-log/audit-log.service';
import { BCRYPT_COST_FACTOR } from '@api/common/constants/bcrypt.constants';
import {
  CreateAdminStaffDto,
  QueryAdminStaffDto,
  UpdateAdminStaffStatusDto,
  AdminStaffResponseDto,
} from './dto/admin-staff.dto';
import {
  PlatformConfigResponseDto,
  UpdatePlatformConfigDto,
} from './dto/admin-platform-config.dto';

const PLATFORM_CONFIG_CACHE_KEY = 'platform:config:governance';

const GOVERNANCE_AUDIT_LOG_SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  adminId: true,
  payload: true,
  ipAddress: true,
  createdAt: true,
} as const;

type GovernanceAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof GOVERNANCE_AUDIT_LOG_SELECT;
}>;

export const ADMIN_STAFF_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  firstName: true,
  lastName: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly cache: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // STAFF GOVERNANCE
  // ---------------------------------------------------------------------------

  async getStaffList(query: QueryAdminStaffDto): Promise<{
    items: AdminStaffResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AdminWhereInput = query.search
      ? {
          OR: [
            { email: { contains: query.search.trim(), mode: 'insensitive' } },
            {
              firstName: { contains: query.search.trim(), mode: 'insensitive' },
            },
            {
              lastName: { contains: query.search.trim(), mode: 'insensitive' },
            },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        select: ADMIN_STAFF_SELECT,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.admin.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async createStaff(
    dto: CreateAdminStaffDto,
    creatorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AdminStaffResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const existing = await this.prisma.admin.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST_FACTOR);

    const staff = await this.prisma.admin.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        role: ROLE.ADMIN,
        firstName: dto.firstName?.trim() ?? null,
        lastName: dto.lastName?.trim() ?? null,
        isActive: true,
      },
      select: ADMIN_STAFF_SELECT,
    });

    await this.auditLog.log({
      action: 'ADMIN_STAFF_CREATED',
      entity: 'Admin',
      entityId: staff.id,
      adminId: creatorId,
      payload: { email: staff.email, role: staff.role },
      ipAddress,
      userAgent,
    });

    return staff;
  }

  async updateStaffStatus(
    targetAdminId: string,
    dto: UpdateAdminStaffStatusDto,
    performingAdminId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AdminStaffResponseDto> {
    if (targetAdminId === performingAdminId && !dto.isActive) {
      throw new BadRequestException(
        'You cannot deactivate your own admin account',
      );
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: targetAdminId },
      select: { id: true, email: true, isActive: true },
    });

    if (!admin) {
      throw new NotFoundException('Admin staff not found');
    }

    const updated = await this.prisma.admin.update({
      where: { id: targetAdminId },
      data: {
        isActive: dto.isActive,
        // Invalidate all existing tokens if deactivating
        ...(!dto.isActive
          ? {
              refreshToken: null,
              refreshTokenId: null,
              tokenVersion: { increment: 1 },
            }
          : {}),
      },
      select: ADMIN_STAFF_SELECT,
    });

    await this.auditLog.log({
      action: dto.isActive
        ? 'ADMIN_STAFF_ACTIVATED'
        : 'ADMIN_STAFF_DEACTIVATED',
      entity: 'Admin',
      entityId: targetAdminId,
      adminId: performingAdminId,
      payload: {
        email: updated.email,
        previousActive: admin.isActive,
        newActive: dto.isActive,
      },
      ipAddress,
      userAgent,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // PLATFORM GOVERNANCE
  // ---------------------------------------------------------------------------

  async getPlatformConfig(): Promise<PlatformConfigResponseDto> {
    const cached = await this.cache.get<PlatformConfigResponseDto>(
      PLATFORM_CONFIG_CACHE_KEY,
    );
    if (cached) {
      const legacyConfig = cached as PlatformConfigResponseDto & {
        announcement?: string | null;
      };
      return {
        ...cached,
        maintenanceMessage:
          cached.maintenanceMessage ?? legacyConfig.announcement ?? null,
        announcement:
          legacyConfig.announcement ?? cached.maintenanceMessage ?? null,
      };
    }

    const defaultConfig: PlatformConfigResponseDto = {
      maintenanceMode: false,
      maintenanceMessage: null,
      announcement: null,
      allowRegistrations: true,
      allowVendorRegistrations: true,
      updatedAt: new Date(),
    };

    await this.cache.set(PLATFORM_CONFIG_CACHE_KEY, defaultConfig, 86400);
    return defaultConfig;
  }

  async updatePlatformConfig(
    dto: UpdatePlatformConfigDto,
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<PlatformConfigResponseDto> {
    const current = await this.getPlatformConfig();

    const updated: PlatformConfigResponseDto = {
      maintenanceMode: dto.maintenanceMode ?? current.maintenanceMode,
      maintenanceMessage:
        dto.maintenanceMessage !== undefined
          ? dto.maintenanceMessage
          : dto.announcement !== undefined
            ? dto.announcement
            : current.maintenanceMessage,
      allowRegistrations: dto.allowRegistrations ?? current.allowRegistrations,
      allowVendorRegistrations:
        dto.allowVendorRegistrations ?? current.allowVendorRegistrations,
      updatedAt: new Date(),
    };
    updated.announcement = updated.maintenanceMessage;

    await this.cache.set(PLATFORM_CONFIG_CACHE_KEY, updated, 86400);

    await this.auditLog.log({
      action: 'PLATFORM_CONFIG_UPDATED',
      entity: 'PlatformConfig',
      adminId,
      payload: toAuditPayload({
        previous: current,
        updated: updated,
      }),
      ipAddress,
      userAgent,
    });

    return updated;
  }

  async getSystemOverview(): Promise<{
    usersCount: number;
    vendorsCount: number;
    productsCount: number;
    ordersCount: number;
  }> {
    const [usersCount, vendorsCount, productsCount, ordersCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.vendor.count(),
        this.prisma.product.count({ where: { isDeleted: false } }),
        this.prisma.order.count(),
      ]);

    return { usersCount, vendorsCount, productsCount, ordersCount };
  }

  async getGovernanceAuditLogs(limit = 50): Promise<GovernanceAuditLog[]> {
    return this.prisma.auditLog.findMany({
      take: Math.min(limit, 100),
      orderBy: { createdAt: 'desc' },
      select: GOVERNANCE_AUDIT_LOG_SELECT,
    });
  }
}
