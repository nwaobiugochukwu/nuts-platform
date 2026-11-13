import { PartialType } from '@nestjs/swagger';
import { CreateDiscountCodeDto } from './create-discount-code.dto';

/**
 * Base DTO for updating existing discount codes.
 * All fields from CreateDiscountCodeDto are made optional.
 */
export class UpdateDiscountCodeDto extends PartialType(CreateDiscountCodeDto) {}

export {
  UpdateDiscountCodeDto as UpdateAdminDiscountCodeDto,
  UpdateDiscountCodeDto as UpdateVendorDiscountCodeDto,
};
