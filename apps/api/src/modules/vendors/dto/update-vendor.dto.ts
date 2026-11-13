import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MaxPasswordBytes } from '@api/common/decorators/max-password-bytes.decorator';

export class UpdateVendorDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(120)
  storeName?: string;

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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  storeLogoUrl?: string;
}

export class VendorLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxPasswordBytes()
  password!: string;
}
