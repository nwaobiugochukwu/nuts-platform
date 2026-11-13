import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SearchIndex } from '@api/common/search/search.service';

const ALLOWED_SEARCH_TYPES: SearchIndex[] = [
  'products',
  'vendors',
  'categories',
  'users',
  'orders',
  'discount_codes',
];

/**
 * Search filters â€” sent in the POST body (not the query string).
 * Search results are relevance-scored, so pagination stays page-based
 * (page/limit) inside the body; the flagship cursor endpoint is
 * POST /products/query.
 */
export class QuerySearchBodyDto {
  @ApiPropertyOptional({ description: 'Search query text' })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ description: 'Page number to return', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Search scopes to limit results',
    example: ['products', 'vendors'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(ALLOWED_SEARCH_TYPES, { each: true })
  types?: SearchIndex[];
}
