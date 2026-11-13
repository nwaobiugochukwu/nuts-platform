import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductCardDto } from '@api/modules/products/dto/product-card.dto';

export class VendorResponseDto {
  @ApiProperty({ description: 'Unique identifier of the vendor' })
  id!: string;

  @ApiProperty({ description: 'Email of the vendor' })
  email!: string;

  @ApiProperty({ description: 'First name of the vendor' })
  firstName!: string;

  @ApiProperty({ description: 'Last name of the vendor' })
  lastName!: string;

  @ApiProperty({ description: 'Display name of the store' })
  storeName!: string;

  @ApiProperty({ description: 'URL-friendly store slug' })
  storeSlug!: string;

  @ApiPropertyOptional({ description: 'URL of the store logo', nullable: true })
  storeLogo?: string | null;

  @ApiPropertyOptional({
    description: 'Description of the store',
    nullable: true,
  })
  storeDescription!: string | null;

  @ApiPropertyOptional({ description: 'Business phone number', nullable: true })
  businessPhone!: string | null;

  @ApiPropertyOptional({ description: 'Business email', nullable: true })
  businessEmail!: string | null;

  @ApiPropertyOptional({
    description: 'URL of the store logo (alias)',
    nullable: true,
  })
  storeLogoUrl!: string | null;

  @ApiPropertyOptional({
    description: 'Alt text for the store logo',
    nullable: true,
  })
  storeLogoAltText!: string | null;

  @ApiPropertyOptional({ description: 'Phone number', nullable: true })
  phone!: string | null;

  @ApiProperty({ description: 'Whether the vendor is verified' })
  isVerified!: boolean;

  @ApiPropertyOptional({ description: 'Whether the vendor account is active' })
  isActive!: boolean;

  @ApiPropertyOptional({ description: 'Whether the vendor is approved' })
  isApproved!: boolean;

  @ApiProperty({ description: 'Timestamp when the vendor registered' })
  createdAt!: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the vendor was last updated',
  })
  updatedAt!: Date;

  @ApiPropertyOptional({
    description: 'Categories of products sold by this vendor',
  })
  categories?: Array<{ id: string; name: string; slug: string }>;
}

export class FeaturedVendorDto {
  @ApiProperty({ description: 'Unique vendor identifier' })
  id!: string;

  @ApiProperty({ description: 'Public store name' })
  storeName!: string;

  @ApiProperty({ description: 'Public store slug' })
  storeSlug!: string;

  @ApiProperty({ description: 'Short store description' })
  storeDescription!: string;

  @ApiPropertyOptional({ description: 'Store logo URL', nullable: true })
  storeLogoUrl!: string | null;

  @ApiProperty({ description: 'Whether the store is verified' })
  isVerified!: boolean;

  @ApiProperty({ description: 'Vendor registration timestamp' })
  createdAt!: Date;

  @ApiProperty({ type: [ProductCardDto] })
  featuredProducts!: ProductCardDto[];
}

/** @deprecated Use VendorResponseDto instead */
export { VendorResponseDto as VendorProfileDto };
