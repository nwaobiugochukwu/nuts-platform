// public-store.controller.ts

import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { ProductCardDto } from '@api/modules/products/dto/product-card.dto';
import {
  FeaturedVendorDto,
  VendorProfileDto,
} from '../dto/vendor-response.dto';
import { VendorsService } from '../vendors.service';
import { VendorFollowsService } from '../vendor-follows.service';

@ApiTags('VENDORS - ACCOUNT')
@ApiExtraModels(ApiResponseDto, FeaturedVendorDto, ProductCardDto)
@Public()
@Controller(['vendors/store', 'vendors'])
export class PublicStoreController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly vendorFollows: VendorFollowsService,
  ) {}

  /**
   * Public vendor discovery endpoint.
   *
   * Search/category filtering is delegated to the service so the database
   * can perform the filtering instead of loading large intermediate ID lists
   * into Node.js.
   */
  @Get()
  @Message('All vendors retrieved successfully')
  @ApiOperation({
    summary: 'Get all public vendors',
    description:
      'Retrieve all active, approved vendor stores. Supports filtering by category and store name.',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Filter vendors by category ID',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search vendors by store name',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of matching vendors to return (1â€“50)',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorProfileDto[]>,
  })
  async findAllVendors(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    data: VendorProfileDto[];
    meta: null;
  }> {
    const vendors = await this.vendorsService.findAllPublicVendors(
      categoryId,
      search,
      limit ? Number(limit) : undefined,
    );

    return {
      data: vendors,
      meta: null,
    };
  }

  @Get('featured')
  @Message('Featured public vendors retrieved successfully')
  @ApiOperation({
    summary: 'Get active, approved stores with available products',
    description:
      'Returns a small vendor-discovery set, ordered with verified stores first.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum stores to return (1–12)',
  })
  @ApiOkResponse({
    description: 'Featured stores with two to four available product cards.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ApiResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(FeaturedVendorDto) },
            },
          },
        },
      ],
    },
  })
  async findFeaturedVendors(
    @Query('limit') limit?: string,
  ): Promise<FeaturedVendorDto[]> {
    return this.vendorsService.findFeaturedPublicVendors(
      limit ? Number(limit) : 8,
    );
  }

  @Get([':storeSlug/follower-count', ':storeSlug/followers/count'])
  @Message('Store follower count retrieved successfully')
  @ApiOperation({
    summary: 'Get the public follower count for an active store',
  })
  async followerCount(@Param('storeSlug') storeSlug: string) {
    return this.vendorFollows.publicFollowerCount(storeSlug);
  }

  /**
   * Returns only stores that are currently active and approved.
   */
  @Get(':storeSlug')
  @Message('Store profile retrieved successfully')
  @ApiOperation({
    summary: 'Get public store profile by slug',
    description:
      'Retrieve a vendor store profile by its slug. Only returns active, approved stores.',
  })
  @ApiParam({
    name: 'storeSlug',
    description: 'The store slug (e.g., "my-store")',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorProfileDto>,
  })
  @ApiNotFoundResponse({
    description: 'Store not found',
  })
  async findStoreBySlug(
    @Param('storeSlug') storeSlug: string,
  ): Promise<VendorProfileDto> {
    return this.vendorsService.findStoreBySlug(storeSlug);
  }

  /**
   * Product listing is kept as a separate endpoint because product data
   * can be substantially larger than the vendor profile.
   */
  @Get(':storeSlug/products')
  @Message('Store products retrieved successfully')
  @ApiOperation({
    summary: 'Get public store products',
    description: 'Retrieve active products for a vendor store by slug.',
  })
  @ApiParam({
    name: 'storeSlug',
    description: 'The store slug (e.g., "my-store")',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorProfileDto>,
    description: 'Store profile with products',
  })
  @ApiNotFoundResponse({
    description: 'Store not found',
  })
  async findStoreProducts(@Param('storeSlug') storeSlug: string) {
    return this.vendorsService.findStoreProducts(storeSlug);
  }
}
