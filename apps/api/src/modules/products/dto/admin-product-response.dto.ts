import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminVariantResponseDto } from '@api/modules/product-variants/dto/admin-variant-response.dto';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';
import type { VariantCombinations } from '@api/common/dto/variant-combinations.dto';

export { CategoryRefDto as AdminProductCategoryRefDto };

class AdminVendorRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() storeSlug!: string;
  @ApiPropertyOptional() storeLogoUrl?: string | null;
}

class AdminProductImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() publicId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() isCover!: boolean;
}

export class AdminProductResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty() sku!: string;
  @ApiProperty() hasVariants!: boolean;
  @ApiPropertyOptional() price?: number;
  @ApiProperty() stock!: number;
  @ApiProperty() inStock!: boolean;
  @ApiProperty() stockStatus!: string;
  @ApiPropertyOptional({
    type: () => AdminVariantResponseDto,
    isArray: true,
  })
  variants?: AdminVariantResponseDto[];

  @ApiPropertyOptional({
    description:
      'Grouped unique option values across all variants â€” useful for building filter UIs',
    example: { size: ['S', 'M', 'L'], color: ['Black', 'Red'] },
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string' },
    },
  })
  variantCombinations?: VariantCombinations;
  @ApiProperty({ type: () => AdminVendorRefDto })
  vendor!: AdminVendorRefDto;
  @ApiProperty({ type: () => CategoryRefDto })
  category!: CategoryRefDto;

  @ApiPropertyOptional({ type: () => CategoryRefDto })
  parentSubcategory?: CategoryRefDto;

  @ApiPropertyOptional({ type: () => CategoryRefDto })
  subcategory?: CategoryRefDto;
  @ApiPropertyOptional({ type: () => AdminProductImageDto, isArray: true })
  images?: AdminProductImageDto[];
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isDeleted!: boolean;
  @ApiPropertyOptional() deletedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
