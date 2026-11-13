import { Controller, Get, Query } from '@nestjs/common';
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
import { GetVendor } from '@api/common/decorators/get-vendor.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { SearchService } from '../search.service';
import { QuerySearchDto } from '../dto/query-search.dto';
import { SearchResponseDto, SearchResultDto } from '../dto/search-result.dto';

@ApiExtraModels(SearchResultDto, ApiResponseDto)
@ApiTags('VENDOR - SEARCH')
@ApiBearerAuth('JWT-auth')
@Controller('vendors/search')
@Roles(ROLE.VENDOR)
export class VendorSearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary:
      'Vendor personalized global search across products, orders, and discount codes',
    description:
      'Search across your own products, orders, and discount codes. Requires Vendor authentication.',
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
  async search(
    @GetVendor('id')
    vendorId: string,
    @Query() query: QuerySearchDto,
  ): Promise<SearchResponseDto> {
    const page = query.page ?? 1;

    const limit = query.limit ?? 10;

    const result = await this.searchService.searchVendorGlobal(
      vendorId,
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
    summary: 'Vendor autocomplete search suggestions',
    description:
      'Get autocomplete suggestions for vendor dashboard search. Requires Vendor authentication.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto,
  })
  async autocomplete(
    @GetVendor('id')
    vendorId: string,
    @Query() query: QuerySearchDto,
  ): Promise<SearchResponseDto> {
    const limit = query.limit ?? 10;

    const results = await this.searchService.autocompleteVendor(
      vendorId,
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
