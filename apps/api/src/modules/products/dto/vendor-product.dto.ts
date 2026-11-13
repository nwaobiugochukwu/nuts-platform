import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';
import { VariantSummaryDto } from '@api/modules/product-variants/dto/variant-response.dto';

export { CategoryRefDto as VendorProductCategoryDto };

export class VendorProductDto {
  @ApiProperty({
    description: 'Unique identifier of the product',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the product',
    example: 'Handcrafted Wooden Bowl',
  })
  name!: string;

  @ApiProperty({
    description: 'URL-friendly slug derived from the product name',
    example: 'handcrafted-wooden-bowl',
  })
  slug!: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the product',
    example: 'A beautifully handcrafted wooden bowl made from sustainable oak.',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({
    description: 'Current selling price of the product',
    example: 29.99,
  })
  price!: number;

  @ApiProperty({
    description: 'Quantity of the product currently in stock',
    example: 50,
  })
  stock!: number;

  @ApiProperty({
    description: 'Stock keeping unit identifier',
    example: 'HWB-001',
  })
  sku!: string;

  @ApiProperty({
    description: 'Whether the product is currently active and visible',
    example: true,
  })
  isActive!: boolean;

  @ApiProperty({
    description: 'Category this product belongs to',
    type: CategoryRefDto,
  })
  category!: CategoryRefDto;

  @ApiProperty({
    description: 'List of variants associated with the product',
    type: [VariantSummaryDto],
  })
  variants!: VariantSummaryDto[];

  @ApiProperty({
    description: 'Timestamp when the product was created',
    example: '2025-06-13T14:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the product was last updated',
    example: '2025-06-13T15:00:00.000Z',
  })
  updatedAt!: Date;
}
