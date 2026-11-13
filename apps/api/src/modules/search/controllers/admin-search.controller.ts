import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';

import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { SearchService } from '../search.service';
import { QuerySearchDto } from '../dto/query-search.dto';
import { SearchResponseDto, SearchResultDto } from '../dto/search-result.dto';
import {
  SearchReindexResponseDto,
  SearchStatusDto,
} from '../dto/search-status.dto';

@ApiExtraModels(
  SearchResultDto,
  ApiResponseDto,
  SearchStatusDto,
  SearchReindexResponseDto,
)
@ApiTags('ADMIN - SEARCH')
@ApiBearerAuth('JWT-auth')
@Controller('admin/search')
@Roles(ROLE.ADMIN)
export class AdminSearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin global search across users, vendors, products, orders, and discount codes',
    description:
      'Search across all entities in the system. Requires ADMIN role.',
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
              type: 'array',
              items: {
                $ref: getSchemaPath(SearchResultDto),
              },
            },
          },
        },
      ],
    },
  })
  async search(@Query() query: QuerySearchDto): Promise<SearchResponseDto> {
    const page = query.page ?? 1;

    const limit = query.limit ?? 20;

    const result = await this.searchService.searchAdminGlobal(
      query.query ?? '',
      query.types,
      page,
      limit,
    );

    return (result ?? {
      results: [],
      pagination: {
        totalItems: 0,
        page,
        limit,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }) as SearchResponseDto;
  }

  @Get('autocomplete')
  @ApiOperation({
    summary: 'Admin autocomplete search suggestions',
    description:
      'Get autocomplete suggestions for admin search. Requires ADMIN role.',
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

  @Get('status')
  @ApiOperation({
    summary: 'Get search engine status and document metrics',
    description:
      'Returns whether the search engine is operational and the total number of indexable documents. Requires ADMIN role.',
  })
  @ApiResponse({
    status: 200,
    type: SearchStatusDto,
  })
  async getStatus(): Promise<SearchStatusDto> {
    return this.searchService.getSearchStatus();
  }

  @Post('reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reindex search documents and clear search cache',
    description:
      'Purges stale Redis search cache and synchronizes search indices. Requires ADMIN role.',
  })
  @ApiResponse({
    status: 200,
    type: SearchReindexResponseDto,
  })
  async reindex(): Promise<SearchReindexResponseDto> {
    return this.searchService.reindex();
  }
}
