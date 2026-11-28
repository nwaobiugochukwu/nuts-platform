import { ApiProperty } from '@nestjs/swagger';
import { ProductCardDto } from '@api/modules/products/dto/product-card.dto';

export class GoodPlaceToStartItemDto {
  @ApiProperty({ type: ProductCardDto })
  product!: ProductCardDto;

  @ApiProperty({
    enum: ['store_sampler', 'for_you'],
    description:
      'Why it is on the shelf: `store_sampler` is part of the daily spread across stores; `for_you` was picked from what the shopper has done.',
  })
  source!: 'store_sampler' | 'for_you';
}

export class GoodPlaceToStartResponseDto {
  @ApiProperty({
    type: GoodPlaceToStartItemDto,
    isArray: true,
    maxItems: 12,
    description:
      'Up to twelve purchasable products with an image, at most one per store.',
  })
  items!: GoodPlaceToStartItemDto[];
}
