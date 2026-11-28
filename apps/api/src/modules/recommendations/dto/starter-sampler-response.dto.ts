import { ApiProperty } from '@nestjs/swagger';
import { ProductCardDto } from '@api/modules/products/dto/product-card.dto';

export class StarterSamplerVendorSummaryDto {
  @ApiProperty({ description: 'Unique vendor identifier' })
  id!: string;

  @ApiProperty({ description: 'Vendor store name' })
  storeName!: string;

  @ApiProperty({ description: 'Vendor store slug' })
  storeSlug!: string;

  @ApiProperty({ description: 'Vendor store description' })
  storeDescription!: string;

  @ApiProperty({ nullable: true, description: 'Vendor store logo URL' })
  storeLogoUrl!: string | null;

  @ApiProperty({ description: 'Whether this vendor is verified' })
  isVerified!: boolean;
}

export class StarterSamplerVendorResponseDto {
  @ApiProperty({ type: StarterSamplerVendorSummaryDto })
  vendor!: StarterSamplerVendorSummaryDto;

  @ApiProperty({
    type: ProductCardDto,
    isArray: true,
    maxItems: 1,
    description: 'One in-stock product with an image from this vendor.',
  })
  products!: ProductCardDto[];
}

export class StarterSamplerResponseDto {
  @ApiProperty({
    type: StarterSamplerVendorResponseDto,
    isArray: true,
    maxItems: 12,
    description: 'Up to twelve distinct active vendors.',
  })
  vendors!: StarterSamplerVendorResponseDto[];
}
