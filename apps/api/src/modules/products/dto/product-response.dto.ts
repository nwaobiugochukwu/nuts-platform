import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VariantSummaryDto } from '@api/modules/product-variants/dto/variant-response.dto';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';
import type { VariantCombinations } from '@api/common/dto/variant-combinations.dto';
import { VendorSummaryDto } from './vendor-summary.dto';

export { CategoryRefDto as ProductCategoryRefDto };

class ProductImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() publicId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() isCover!: boolean;
}

export class ProductResponseDto {
  @ApiProperty({ description: 'Unique identifier of the product' })
  id!: string;

  @ApiProperty({ description: 'Display name of the product' })
  name!: string;

  @ApiProperty({ description: 'URL-friendly slug' })
  slug!: string;

  @ApiPropertyOptional({ description: 'Detailed description of the product' })
  description!: string | null;

  @ApiProperty({ description: 'Product-level SKU', example: 'TSHIRT-001' })
  sku!: string;

  @ApiProperty({ description: 'Whether the product has variants' })
  hasVariants!: boolean;

  @ApiPropertyOptional({
    description: 'Product price (used when hasVariants=false)',
  })
  price?: number;

  @ApiProperty({
    description: 'Product stock (or computed total across variants)',
  })
  stock!: number;

  @ApiProperty({ description: 'Whether the product is available for purchase' })
  inStock!: boolean;

  @ApiProperty({ description: 'Human-readable inventory status' })
  stockStatus!: string;

  @ApiPropertyOptional({
    description: 'Variants associated with the product',
    type: () => VariantSummaryDto,
    isArray: true,
  })
  variants?: VariantSummaryDto[];

  @ApiPropertyOptional({
    description:
      'Grouped unique option values across all variants â€” useful for building filter UIs. ' +
      'Only present when the product has variants.',
    example: { size: ['S', 'M', 'L'], color: ['Black', 'Red'] },
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string' },
    },
  })
  variantCombinations?: VariantCombinations;

  @ApiProperty({
    description: 'The vendor who owns this product',
    type: () => VendorSummaryDto,
  })
  vendor!: VendorSummaryDto;

  @ApiProperty({
    description: 'Main category this product belongs to',
    type: () => CategoryRefDto,
  })
  category!: CategoryRefDto | null;

  @ApiPropertyOptional({
    description: 'Parent subcategory this product belongs to (optional)',
    type: () => CategoryRefDto,
  })
  parentSubcategory?: CategoryRefDto | null;

  @ApiPropertyOptional({
    description: 'Subcategory this product belongs to (optional)',
    type: () => CategoryRefDto,
  })
  subcategory?: CategoryRefDto | null;

  @ApiPropertyOptional({
    description: 'Legacy field for backward compatibility',
  })
  imageUrl!: string | null;

  @ApiProperty({ description: 'Array of product images' })
  images!: ProductImageDto[];

  @ApiProperty({ description: 'Whether the product is active and visible' })
  isActive!: boolean;

  @ApiProperty({ description: 'Timestamp when created' })
  createdAt!: Date;

  @ApiProperty({ description: 'Timestamp when last updated' })
  updatedAt!: Date;
}
