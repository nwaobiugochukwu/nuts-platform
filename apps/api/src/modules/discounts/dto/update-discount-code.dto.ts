import { PartialType } from '@nestjs/swagger';
import {
  CreateAdminDiscountCodeDto,
  CreateDiscountCodeDto,
  CreateVendorDiscountCodeDto,
} from './create-discount-code.dto';

/**
 * Base DTO for updating existing discount codes.
 * All fields from CreateDiscountCodeDto are made optional.
 */
export class UpdateDiscountCodeDto extends PartialType(CreateDiscountCodeDto) {}

export class UpdateAdminDiscountCodeDto extends PartialType(
  CreateAdminDiscountCodeDto,
) {}

/** Vendors cannot update `platformwide` either. */
export class UpdateVendorDiscountCodeDto extends PartialType(
  CreateVendorDiscountCodeDto,
) {}
