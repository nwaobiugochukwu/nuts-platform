import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DISCOUNT_CODE_PATTERN } from '@api/common/constants/discount.constants';

export class ClaimVoucherDto {
  @ApiProperty({
    example: 'SAVE20',
    description: 'Voucher code to save to your account.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @Matches(DISCOUNT_CODE_PATTERN, { message: 'Invalid voucher code format.' })
  code!: string;
}
