import { CartResponseDto } from '../cart-response.dto';

/**
 * Response for DELETE /cart/items/:productId
 * Returns the cart summary and the ID of the removed item.
 */
export class RemoveCartItemResponseDto {
  cart!: CartResponseDto;
}
