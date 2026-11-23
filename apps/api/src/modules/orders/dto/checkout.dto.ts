import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ShippingAddressDto } from '@api/common/dto/shipping-address.dto';

export { ShippingAddressDto as ShippingAddressInput };

export class CheckoutDto {
  @ApiPropertyOptional({
    description:
      'Inline shipping address. Mutually exclusive with the addressId query parameter.',
    type: ShippingAddressDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  @ApiPropertyOptional({
    description: 'Optional discount code to apply at checkout.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  discountCode?: string;

  @ApiPropertyOptional({
    description:
      'Up to two vouchers to apply (one store voucher + one platform voucher, both must be combinable).',
    type: [String],
    maxItems: 2,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  discountCodes?: string[];
}
