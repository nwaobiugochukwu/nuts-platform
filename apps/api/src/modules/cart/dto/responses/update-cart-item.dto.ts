import { CartResponseDto } from '../cart-response.dto';

/**
 * Response for PATCH /cart/items/:productId
 * Returns the full updated cart, consistent with the service response.
 */
export class UpdateCartItemResponseDto extends CartResponseDto {}
