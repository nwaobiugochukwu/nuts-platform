import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { MaxPasswordBytes } from '@api/modules/shared/decorators/max-password-bytes.decorator';
import { NormalizeEmail } from '@api/modules/shared/decorators/normalize-email.decorator';
import { Trim } from '@api/modules/shared/decorators/string-trim.decorator';
import { ShippingAddressDto } from '@api/modules/shared/dto/shipping-address.dto';

export { ShippingAddressDto as ShippingAddressRegistrationDto };

export class RegisterDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({
    example: 'StrongPassword123!',
  })
  @IsString()
  @MinLength(8, {
    message: 'Password must be at least 8 characters',
  })
  @MaxLength(128)
  @MaxPasswordBytes()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  password!: string;

  @ApiProperty({
    example: '123456',
  })
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'OTP code is required' })
  @Matches(/^\d{6}$/, {
    message: 'OTP code must be 6 digits',
  })
  otpCode!: string;

  @ApiPropertyOptional({
    example: 'Jane',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone number must include international country code (e.g. +2349064786655)',
  })
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Optional referral code from another user',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  referralCode?: string;

  @ApiPropertyOptional({
    description: 'Optional shipping address collected during registration',
    type: ShippingAddressDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;
}
