import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { AdminCacheBypass } from '@api/common/decorators/admin-cache-bypass.decorator';
import { ModerateThrottle } from '@api/common/decorators/custom-throttler.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';

import {
  ApiResponseDto,
  PaginationMetaDto,
} from '@api/common/dto/api-response.dto';

import { CursorPaginationMetaDto } from '@api/common/utils/cursor-pagination.util';

import { ProductCardDto } from '../dto/product-card.dto';
import { PublicProductResponseDto } from '../dto/public-product-response.dto';
import { QueryProductDto } from '../dto/query-product.dto';
import { QueryProductsBodyDto } from '../dto/query-products-body.dto';
import { ProductsService } from '../products.service';

@ApiTags('PRODUCTS')
@ApiExtraModels(
  ApiResponseDto,
  PaginationMetaDto,
  CursorPaginationMetaDto,
  ProductCardDto,
  PublicProductResponseDto,
)
@Public()
@Controller('products')
export class ProductController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * Cursor-based public product search.
   *
   * Accepts a structured filter body and is designed for the storefront's cursor-search flow.
   */
  @ModerateThrottle()
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List and search products with cursor pagination',
    description:
      'Returns active, non-deleted products. Pass meta.nextCursor from the previous response as cursor to retrieve the next page.',
  })
  @ApiOkResponse({
    description: 'Cursor-paginated product list.',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              type: 'array',
              items: {
                $ref: getSchemaPath(ProductCardDto),
              },
            },
            meta: {
              $ref: getSchemaPath(CursorPaginationMetaDto),
            },
          },
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid product filters or cursor.',
  })
  async queryProducts(
    @Body() body: QueryProductsBodyDto,
    @AdminCacheBypass() bypassCache: boolean,
  ): Promise<{
    data: ProductCardDto[];
    meta: CursorPaginationMetaDto;
  }> {
    return this.productsService.findAllPublicCursor({
      ...body,
      bypassCache,
    });
  }

  /**
   * Public product catalog and filter endpoint.
   *
   * Supports both cursor-based (when cursor is provided) and page-based pagination.
   */
  @ModerateThrottle()
  @Get()
  @ApiOperation({
    summary: 'List and search products',
    description:
      'Returns active, non-deleted products. Use this route for numbered catalog pages; use GET /discover for the cursor-paginated product feed.',
  })
  @ApiOkResponse({
    description: 'Paginated product list.',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              type: 'array',
              items: {
                $ref: getSchemaPath(ProductCardDto),
              },
            },
            meta: {
              oneOf: [
                { $ref: getSchemaPath(PaginationMetaDto) },
                { $ref: getSchemaPath(CursorPaginationMetaDto) },
              ],
            },
          },
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
  })
  async findAll(
    @Query() query: QueryProductDto,
    @AdminCacheBypass() bypassCache: boolean,
  ): Promise<{
    data: ProductCardDto[];
    meta: PaginationMetaDto | CursorPaginationMetaDto;
  }> {
    return this.productsService.findAllPublic({
      ...query,
      bypassCache,
    });
  }

  /**
   * Public trending products by sales volume.
   */
  @ModerateThrottle()
  @Get('trending')
  @ApiOperation({
    summary: 'List trending products by sales volume',
    description:
      'Aggregates confirmed order sales volume over the given window (default 30 days).',
  })
  @ApiOkResponse({
    description: 'Trending product card list.',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              type: 'array',
              items: {
                $ref: getSchemaPath(ProductCardDto),
              },
            },
          },
        },
      ],
    },
  })
  async getTrending(
    @Query('limit') limit?: string,
    @Query('days') days?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @AdminCacheBypass() bypassCache?: boolean,
  ): Promise<ProductCardDto[]> {
    const parsedMinPrice =
      minPrice === undefined ? undefined : Number(minPrice);
    const parsedMaxPrice =
      maxPrice === undefined ? undefined : Number(maxPrice);
    return this.productsService.findTrending({
      limit: limit ? parseInt(limit, 10) : 20,
      days: days ? parseInt(days, 10) : 30,
      categoryId,
      search,
      minPrice: Number.isFinite(parsedMinPrice) ? parsedMinPrice : undefined,
      maxPrice: Number.isFinite(parsedMaxPrice) ? parsedMaxPrice : undefined,
      bypassCache,
    });
  }

  @ModerateThrottle()
  @Get('category-previews')
  @ApiOperation({
    summary: 'Load a small first page for each direct subcategory',
    description:
      'Returns at most 12 newest product cards per active direct child category for instant in-page browsing.',
  })
  async getCategoryPreviews(
    @Query('parentCategoryId') parentCategoryId: string,
    @Query('limit') limit?: string,
  ): Promise<
    Record<
      string,
      { items: ProductCardDto[]; totalItems: number; totalPages: number }
    >
  > {
    return this.productsService.findCategoryPreviews(
      parentCategoryId,
      limit ? parseInt(limit, 10) : 12,
    );
  }

  /**
   * Public product detail.
   *
   * Slug is used instead of an internal product ID so the storefront URL
   * remains stable and does not expose database identifiers.
   */
  @ModerateThrottle()
  @Get(':slug')
  @Message('Product retrieved successfully')
  @ApiOperation({
    summary: 'Get product by slug',
    description: 'Returns one active, non-deleted product.',
  })
  @ApiParam({
    name: 'slug',
    description: 'Product slug, for example nike-air-max',
    example: 'nike-air-max',
  })
  @ApiOkResponse({
    description: 'Product details.',
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              $ref: getSchemaPath(PublicProductResponseDto),
            },
          },
        },
      ],
    },
  })
  @ApiNotFoundResponse({
    description: 'Product not found.',
  })
  async findBySlug(
    @Param('slug') slug: string,
    @AdminCacheBypass() bypassCache: boolean,
  ): Promise<PublicProductResponseDto> {
    return this.productsService.findOnePublic(slug, bypassCache);
  }
}
