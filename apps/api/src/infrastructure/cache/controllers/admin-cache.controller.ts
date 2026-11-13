import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

export interface CacheStatsResult {
  connected: boolean;
  totalKeys: number;
  memoryUsed: string;
  uptimeInSeconds?: number;
}

@ApiTags('ADMIN - CACHE')
@ApiBearerAuth('JWT-auth')
@Controller('admin/cache')
@Roles(ROLE.ADMIN)
export class AdminCacheController {
  constructor(private readonly cacheService: CacheService) {}

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @Message('Cache statistics retrieved successfully')
  @ApiOperation({
    summary: 'Get Redis cache cluster operational metrics',
    description:
      'Returns active connection status, total key references, and estimated memory utilization.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<CacheStatsResult>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” admin session required',
  })
  async getStats(): Promise<CacheStatsResult> {
    const [stats, memoryUsed] = await Promise.all([
      this.cacheService.getStats(),
      this.cacheService.getMemoryUsage(),
    ]);

    return {
      connected: stats.available,
      totalKeys: stats.keys,
      memoryUsed,
    };
  }

  @Post('invalidate/categories')
  @Delete('categories')
  @HttpCode(HttpStatus.OK)
  @Message('Category hierarchy cache invalidated successfully')
  @ApiOperation({
    summary: 'Invalidate category taxonomy cache',
    description:
      'Clears the category tree and taxonomy ancestor path caches across all instances.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<{ message: string }>,
  })
  async invalidateCategories(): Promise<{ message: string }> {
    await this.cacheService.invalidateCategoryCache();
    await this.cacheService.delByPattern('categories:*');
    await this.cacheService.delByPattern('category:*');
    return { message: 'Category cache invalidated successfully' };
  }

  @Post('invalidate/products')
  @Delete('products')
  @HttpCode(HttpStatus.OK)
  @Message('Product catalog cache invalidated successfully')
  @ApiOperation({
    summary: 'Invalidate product catalog cache',
    description:
      'Clears storefront catalog lists, facet filters, and product card caches.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<{ message: string }>,
  })
  async invalidateProducts(): Promise<{ message: string }> {
    await this.cacheService.delByPattern('product:*');
    await this.cacheService.delByPattern('products:*');
    return { message: 'Product catalog cache invalidated successfully' };
  }

  @Post('invalidate/all')
  @Delete('all')
  @HttpCode(HttpStatus.OK)
  @Message('Platform cache invalidated successfully')
  @ApiOperation({
    summary: 'Invalidate all Redis caches',
    description: 'Purges all application keys across the marketplace cache.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<{ message: string }>,
  })
  async invalidateAll(): Promise<{ message: string }> {
    await this.cacheService.clear();
    return { message: 'All platform caches invalidated successfully' };
  }

  @Get('flush')
  @HttpCode(HttpStatus.OK)
  @Message('Cache invalidated successfully')
  @ApiOperation({
    summary: 'Legacy flush endpoint (retained for backward compatibility)',
  })
  async flush(): Promise<{ message: string }> {
    await this.cacheService.clear();
    return { message: 'Cache invalidated successfully' };
  }
}
