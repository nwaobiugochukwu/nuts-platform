import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ToBoolean } from '@api/common/decorators/to-boolean.decorator';
export class QueryProductDto {
  @ApiPropertyOptional({
    description: 'Match product names, descriptions, or SKUs.',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by a hierarchical category path.',
  })
  @IsString()
  @IsOptional()
  categoryPath?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID or slug' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by category UUID.' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by vendor UUID.' })
  @IsString()
  @IsOptional()
  vendorId?: string;

  @ApiPropertyOptional()
  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  inStock?: boolean;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  /** Admin only: defaults to false (excludes soft-deleted). Pass true to list deleted products. */
  @ApiPropertyOptional({
    description: 'Admin: include soft-deleted products when true',
  })
  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  isDeleted?: boolean;

  /** Admin/Vendor: filter by active flag. Omit to include both active and inactive. */
  @ApiPropertyOptional({ description: 'Filter by isActive when set' })
  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from the previous response (meta.nextCursor). Omit for the first page.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Sorting criteria: newest, oldest, price_asc, price_desc',
    enum: ['newest', 'oldest', 'price_asc', 'price_desc'],
  })
  @IsString()
  @IsIn(['newest', 'oldest', 'price_asc', 'price_desc'])
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
