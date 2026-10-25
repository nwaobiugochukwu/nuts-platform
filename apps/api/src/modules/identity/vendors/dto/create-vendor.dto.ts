import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MaxPasswordBytes } from '@api/modules/shared/decorators/max-password-bytes.decorator';

export class CreateVendorDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @MaxPasswordBytes()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  storeName!: string;

  @ApiPropertyOptional({
    description:
      'Optional store slug. If omitted, the slug is generated from the storeName.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storeSlug?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  storeDescription?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone number must include international country code (e.g. +2349064786655)',
  })
  businessPhone?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  businessEmail?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone number must include international country code (e.g. +2349064786655)',
  })
  phone?: string;

  @ApiProperty({ description: 'OTP code sent to the email address' })
  @IsString()
  otpCode!: string;
}
