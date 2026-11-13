import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '@api/common/decorators/string-trim.decorator';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name',
    minLength: 2,
    maxLength: 100,
    example: 'Electronics',
  })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description:
      'URL-friendly slug. Auto-generated from name if omitted. ' +
      'Lowercase letters, numbers, and hyphens only.',
    maxLength: 120,
    example: 'electronics',
  })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ description: 'Category description', maxLength: 500 })
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Category image or icon URL' })
  @Trim()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'UUID of the parent category. Omit or pass null for root categories.',
    example: 'c1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({
    description: 'Display sort order among sibling categories (default: 0)',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Lifecycle status of the category',
    enum: CategoryStatus,
    default: CategoryStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @ApiPropertyOptional({
    description: 'Is the category active? (Backward compatibility)',
  })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Deprecated level field for legacy clients',
  })
  @IsOptional()
  @IsString()
  level?: string;
}
