import { ApiProperty } from '@nestjs/swagger';
import { ProductCardDto } from '@api/modules/products/dto/product-card.dto';

export class MarketplaceMixVendorSummaryDto {
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

export class MarketplaceMixVendorResponseDto {
  @ApiProperty({ type: MarketplaceMixVendorSummaryDto })
  vendor!: MarketplaceMixVendorSummaryDto;

  @ApiProperty({
    type: ProductCardDto,
    isArray: true,
    maxItems: 1,
    description: 'One in-stock product with an image from this vendor.',
  })
  products!: ProductCardDto[];
}

export class MarketplaceMixResponseDto {
  @ApiProperty({
    type: MarketplaceMixVendorResponseDto,
    isArray: true,
    maxItems: 12,
    description: 'Up to twelve distinct active vendors.',
  })
  vendors!: MarketplaceMixVendorResponseDto[];
}
