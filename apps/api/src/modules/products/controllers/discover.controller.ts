import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { AdminCacheBypass } from '@api/common/decorators/admin-cache-bypass.decorator';
import { RelaxedThrottle } from '@api/common/decorators/custom-throttler.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { CursorPaginationMetaDto } from '@api/common/utils/cursor-pagination.util';

import { ProductCardDto } from '../dto/product-card.dto';
import { QueryProductDto } from '../dto/query-product.dto';
import { ProductsService } from '../products.service';

@ApiTags('DISCOVER')
@ApiExtraModels(ApiResponseDto, CursorPaginationMetaDto, ProductCardDto)
@Public()
@Controller('discover')
export class DiscoverController {
  constructor(private readonly productsService: ProductsService) {}

  @RelaxedThrottle()
  @Get()
  @ApiOperation({
    summary: 'Browse the personalized-ready product discovery feed',
    description:
      'Returns active marketplace products with stable cursor pagination. Keep the same filters and sort order when requesting the next page. Supports search, category, vendor, stock, price, and sort filters.',
  })
  @ApiOkResponse({
    description: 'Cursor-paginated product discovery results.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ApiResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ProductCardDto) },
            },
            meta: { $ref: getSchemaPath(CursorPaginationMetaDto) },
          },
        },
      ],
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid product filters or cursor.' })
  discover(
    @Query() query: QueryProductDto,
    @AdminCacheBypass() bypassCache: boolean,
  ) {
    return this.productsService.findAllPublicCursor({
      ...query,
      bypassCache,
    });
  }
}
