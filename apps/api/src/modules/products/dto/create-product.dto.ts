import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateVariantDto } from '@api/modules/product-variants/dto/create-variant.dto';
import { Trim } from '@api/common/decorators/string-trim.decorator';
import { TrimEmptyToUndefined } from '@api/common/decorators/trim-empty-to-undefined.decorator';

export class CreateProductDto {
  @ApiProperty()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @TrimEmptyToUndefined()
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiProperty({ required: false })
  @Trim()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, default: false })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  hasVariants?: boolean;

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiProperty()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Z0-9-_]+$/i, {
    message: 'SKU can only contain letters, numbers, hyphens, and underscores',
  })
  sku!: string;

  @ApiProperty({
    description: 'The id of the product category.',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ required: false })
  @IsUrl()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Array of image URLs for the product (max 6).',
  })
  @IsUrl({}, { each: true })
  @IsOptional()
  imageUrls?: string[];

  @ApiProperty({ required: false, default: true })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: () => CreateVariantDto,
    isArray: true,
    description:
      'Optional initial variants for products that have variants enabled.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  @IsOptional()
  variants?: CreateVariantDto[];
}
