import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';

export class VendorSummaryDto {
  @ApiProperty({
    description: 'Unique identifier of the vendor',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the vendor store',
    example: 'Artisan Leather Co.',
  })
  storeName!: string;

  @ApiProperty({
    description: 'URL-friendly slug of the vendor store',
    example: 'artisan-leather-co',
  })
  storeSlug!: string;

  @ApiPropertyOptional({
    description: 'Email address of the vendor',
    example: 'vendor@example.com',
  })
  email?: string;

  @ApiPropertyOptional({
    description: 'Description of the vendor store',
    example: 'Premium handcrafted leather goods',
  })
  storeDescription?: string;

  @ApiPropertyOptional({
    description: 'Store logo image URL',
    example: 'https://cdn.example.com/stores/logo.png',
  })
  storeLogoUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether the vendor is verified',
    example: true,
  })
  isVerified?: boolean;
}

export class ProductCardDto {
  @ApiPropertyOptional({
    description:
      'Whether the product requires selecting a variant before adding it to a cart',
    example: false,
  })
  hasVariants?: boolean;

  @ApiPropertyOptional({
    description: 'Why this product was recommended for the current shopper',
  })
  recommendationReason?: string;

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

  @ApiProperty({
    description: 'Current selling price of the product',
    example: 29.99,
  })
  price!: number;

  @ApiPropertyOptional({
    description: 'Discounted price, if a promotion is active',
    example: 24.99,
    nullable: true,
  })
  discountPrice!: number | null;

  @ApiPropertyOptional({
    description: 'URL of the primary product thumbnail image',
    example: 'https://cdn.example.com/products/wooden-bowl-thumb.jpg',
    nullable: true,
  })
  thumbnail!: string | null;

  @ApiProperty({
    description: 'Human-readable inventory status label',
    example: 'In stock',
  })
  stockStatus!: string;

  @ApiProperty({
    description: 'Summary of the vendor (store owner)',
    type: VendorSummaryDto,
  })
  vendor!: VendorSummaryDto;

  @ApiPropertyOptional({
    description: 'Root category identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    nullable: true,
  })
  categoryId?: string | null;

  @ApiPropertyOptional({
    description: 'Root category summary',
    type: () => CategoryRefDto,
    nullable: true,
  })
  category?: CategoryRefDto | null;

  @ApiPropertyOptional({
    description: 'Parent subcategory summary',
    type: () => CategoryRefDto,
    nullable: true,
  })
  parentSubcategory?: CategoryRefDto | null;

  @ApiPropertyOptional({
    description: 'Leaf subcategory summary',
    type: () => CategoryRefDto,
    nullable: true,
  })
  subcategory?: CategoryRefDto | null;
}
