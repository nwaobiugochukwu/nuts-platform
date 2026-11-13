import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryRefDto } from '@api/common/dto/category-ref.dto';

export { CategoryRefDto as ProductCategoryInfoDto };

class ProductImageDto {
  @ApiProperty({
    description: 'URL of the product image',
    example: 'https://cdn.example.com/products/wooden-bowl-1.jpg',
  })
  url!: string;

  @ApiPropertyOptional({
    description: 'Alt text for the product image',
    example: 'Handcrafted wooden bowl viewed from above',
    nullable: true,
  })
  altText!: string | null;
}

class ProductVendorInfoDto {
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
    description: 'URL of the store logo image',
    example: 'https://cdn.example.com/logos/artisan-leather-co.png',
    nullable: true,
  })
  storeLogoUrl!: string | null;
}

export class ProductDetailsDto {
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

  @ApiPropertyOptional({
    description: 'Discounted price, if a promotion is active',
    example: 24.99,
    nullable: true,
  })
  discountPrice!: number | null;

  @ApiProperty({
    description: 'Quantity of the product currently in stock',
    example: 50,
  })
  stock!: number;

  @ApiProperty({
    description: 'Product images',
    type: [ProductImageDto],
  })
  images!: ProductImageDto[];

  @ApiProperty({
    description: 'Category this product belongs to',
    type: CategoryRefDto,
  })
  category!: CategoryRefDto;

  @ApiPropertyOptional({
    description: 'Parent subcategory this product belongs to',
    type: CategoryRefDto,
  })
  parentSubcategory?: CategoryRefDto;

  @ApiPropertyOptional({
    description: 'Subcategory this product belongs to',
    type: CategoryRefDto,
  })
  subcategory?: CategoryRefDto;

  @ApiProperty({
    description: 'The vendor (store owner) who owns this product',
    type: ProductVendorInfoDto,
  })
  vendor!: ProductVendorInfoDto;

  @ApiProperty({
    description: 'Average rating based on customer reviews',
    example: 4.5,
  })
  averageRating!: number;

  @ApiProperty({
    description: 'Total number of reviews',
    example: 42,
  })
  reviewCount!: number;
}
