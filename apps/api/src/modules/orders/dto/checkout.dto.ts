import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
}
