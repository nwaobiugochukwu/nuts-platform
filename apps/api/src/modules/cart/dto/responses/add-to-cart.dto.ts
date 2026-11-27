import { ApiProperty } from '@nestjs/swagger';
import { CartItemResponseDto, CartMetadataDto } from '../cart-response.dto';

/**
 * Response for POST /cart/items/:productId
 * Returns the cart summary and the specific item that was added/incremented.
 */
export class AddToCartResponseDto {
  @ApiProperty({
    type: () => CartMetadataDto,
    description: 'The updated cart summary metadata',
  })
  cart!: CartMetadataDto;

  @ApiProperty({
    type: () => CartItemResponseDto,
    description: 'The cart item that was just added or incremented',
  })
  addedItem!: CartItemResponseDto;
}
