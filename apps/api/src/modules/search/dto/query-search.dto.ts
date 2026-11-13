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

export class QuerySearchDto {
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
