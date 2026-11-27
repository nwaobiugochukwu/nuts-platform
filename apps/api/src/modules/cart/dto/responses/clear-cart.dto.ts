import { CartResponseDto } from '../cart-response.dto';

/**
 * Response for DELETE /cart
 * Returns the empty cart with all metadata reset.
 */
export class ClearCartResponseDto extends CartResponseDto {}
