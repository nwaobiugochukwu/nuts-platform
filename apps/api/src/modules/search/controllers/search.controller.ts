import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { SearchService } from '../search.service';
import { QuerySearchBodyDto } from '../dto/query-search-body.dto';
import { QuerySearchDto } from '../dto/query-search.dto';
import { SearchProductHitDto } from '../dto/search-product-hit.dto';
import { SearchProductsResponseDto } from '../dto/search-products-response.dto';
import { SearchResponseDto, SearchResultDto } from '../dto/search-result.dto';

@ApiExtraModels(SearchResultDto, SearchProductHitDto, ApiResponseDto)
@ApiTags('SEARCH')
@Public()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @Message('Search results retrieved successfully')
  @ApiOperation({
    summary: 'Global search with filters in the request body',
    description:
      'Search products and other marketplace entities. Pass types=["products"] for detailed product results.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body',
  })
  @ApiResponse({
    status: 200,
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              oneOf: [
                {
                  type: 'array',
                  items: {
                    $ref: getSchemaPath(SearchResultDto),
                  },
                },
                {
                  type: 'array',
                  items: {
                    $ref: getSchemaPath(SearchProductHitDto),
                  },
                },
              ],
            },
          },
        },
      ],
    },
  })
  async searchWithBody(
    @Body() body: QuerySearchBodyDto,
  ): Promise<SearchResponseDto | SearchProductsResponseDto> {
    return this.search({
      query: body.query,
      types: body.types,
      page: body.page,
      limit: body.limit,
    });
  }

  @Get()
  @Message('Search results retrieved successfully')
  @ApiOperation({
    summary: 'Global marketplace search',
    description:
      'Search marketplace entities. Pass types=products for detailed storefront product results.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters',
  })
  @ApiResponse({
    status: 200,
    schema: {
      allOf: [
        {
          $ref: getSchemaPath(ApiResponseDto),
        },
        {
          properties: {
            data: {
              oneOf: [
                {
                  type: 'array',
                  items: {
                    $ref: getSchemaPath(SearchResultDto),
                  },
                },
                {
                  type: 'array',
                  items: {
                    $ref: getSchemaPath(SearchProductHitDto),
                  },
                },
              ],
            },
          },
        },
      ],
    },
  })
  async search(
    @Query() query: QuerySearchDto,
  ): Promise<SearchResponseDto | SearchProductsResponseDto> {
    const page = query.page ?? 1;

    const limit = query.limit ?? 10;

    const types = query.types;

    const onlyProducts = types?.length === 1 && types[0] === 'products';

    if (onlyProducts) {
      const result = await this.searchService.searchProductsWithDetails(
        query.query ?? '',
        page,
        limit,
      );

      if (!result) {
        return {
          results: [],
          pagination: {
            totalItems: 0,
            page,
            limit,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };
      }

      return {
        results: result.hits,
        pagination: {
          totalItems: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
          totalPages: result.pagination.totalPages,
          hasNextPage: result.pagination.page < result.pagination.totalPages,
          hasPreviousPage: result.pagination.page > 1,
        },
      };
    }

    const result = await this.searchService.searchMarketplace(
      query.query ?? '',
      types,
      page,
      limit,
    );

    if (!result) {
      return {
        results: [],
        pagination: {
          totalItems: 0,
          page,
          limit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    return {
      results: result.results,
      pagination: {
        totalItems: result.pagination.total,
        page: result.pagination.page,
        limit: result.pagination.limit,
        totalPages: result.pagination.totalPages,
        hasNextPage: result.pagination.page < result.pagination.totalPages,
        hasPreviousPage: result.pagination.page > 1,
      },
    };
  }

  @Get('autocomplete')
  @Message('Autocomplete suggestions retrieved successfully')
  @ApiOperation({
    summary: 'Autocomplete suggestions for marketplace search',
    description: 'Get autocomplete suggestions for the marketplace search bar.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto,
  })
  async autocomplete(
    @Query() query: QuerySearchDto,
  ): Promise<SearchResponseDto> {
    const limit = query.limit ?? 10;

    const results = await this.searchService.autocomplete(
      query.query ?? '',
      query.types,
      limit,
    );

    return {
      results: results ?? [],
      pagination: {
        totalItems: results?.length ?? 0,
        page: 1,
        limit,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }
}
