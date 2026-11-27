import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PLATFORM_CONFIG_CACHE_KEY } from '@api/common/constants/platform-config.constants';
import {
  PlatformConfigResponseDto,
  UpdatePlatformConfigDto,
} from '../dto/admin-platform-config.dto';
import { auditDetails } from '@api/modules/audit/utils/audit-details.util';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}
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

    auditDetails({
      payload: {
        previous: current,
        updated: updated,
      },
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
}
