import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';

export { CategoryRefDto as ProductCategorySummaryDto };

export class ProductSummaryDto {
  @ApiProperty({
    description: 'Unique product identifier',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  id!: string;

  @ApiProperty({
    description: 'Product display name',
    example: 'Handcrafted Leather Bifold Wallet',
  })
  name!: string;

  @ApiProperty({
    description: 'URL-friendly product slug',
    example: 'handcrafted-leather-bifold-wallet',
  })
  slug!: string;

  @ApiProperty({
    description: 'Current selling price of the product',
    example: 79.99,
  })
  price!: number;

  @ApiProperty({
    description: 'Current stock quantity available',
    example: 45,
  })
  stock!: number;

  @ApiProperty({
    description: 'Whether the product is available for purchase',
    example: true,
  })
  inStock!: boolean;

  @ApiProperty({
    description: 'Product inventory status label',
    example: 'Few items left',
  })
  stockStatus!: string;

  @ApiProperty({
    description: 'Subcategory the product belongs to',
    type: CategoryRefDto,
  })
  subcategory!: CategoryRefDto;

  @ApiPropertyOptional({
    description: 'URL of the primary product image (nullable)',
    example: 'https://cdn.example.com/products/leather-bifold-wallet-1.jpg',
  })
  imageUrl!: string | null;

  @ApiProperty({
    description:
      'Whether the product is currently active and visible in the store',
    example: true,
  })
  isActive!: boolean;
}
