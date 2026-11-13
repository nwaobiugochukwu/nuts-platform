import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicVariantSummaryDto } from '@api/modules/product-variants/dto/public-variant-response.dto';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';
import type { VariantCombinations } from '@api/common/dto/variant-combinations.dto';
import { VendorSummaryDto } from './vendor-summary.dto';

export { CategoryRefDto as PublicProductCategoryRefDto };

class PublicProductImageDto {
  @ApiProperty()
  url!: string;

  @ApiProperty()
  publicId!: string;

  @ApiProperty()
  isCover!: boolean;
}

export class PublicProductResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional()
  description!: string | null;

  @ApiProperty({ description: 'Product-level SKU' })
  sku!: string;

  @ApiProperty({ description: 'Whether the product has variants' })
  hasVariants!: boolean;

  @ApiPropertyOptional({ description: 'Product price when hasVariants=false' })
  price?: number;

  @ApiProperty({
    description: 'Product stock (or computed total across variants)',
  })
  stock!: number;

  @ApiProperty({ description: 'In stock flag' })
  inStock!: boolean;

  @ApiProperty({ description: 'Stock status label' })
  stockStatus!: string;

  @ApiPropertyOptional({
    description: 'Product-level discount price if applicable',
  })
  discountPrice?: number;

  @ApiProperty({ description: 'Sale percentage for frontend compatibility' })
  salePercentage!: number;

  @ApiPropertyOptional({
    description: 'Active variants',
    type: () => PublicVariantSummaryDto,
    isArray: true,
  })
  variants?: PublicVariantSummaryDto[];

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

  @ApiProperty({ type: () => VendorSummaryDto })
  vendor!: VendorSummaryDto;

  @ApiProperty({ type: () => CategoryRefDto })
  category!: CategoryRefDto;

  @ApiPropertyOptional({ type: () => CategoryRefDto })
  parentSubcategory?: CategoryRefDto;

  @ApiPropertyOptional({ type: () => CategoryRefDto })
  subcategory?: CategoryRefDto;

  @ApiPropertyOptional({
    description: 'Legacy field for backward compatibility',
  })
  imageUrl!: string | null;

  @ApiProperty({ description: 'Array of product images' })
  images!: PublicProductImageDto[];

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
