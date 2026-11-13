import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class VendorGoogleAuthDto {
  @ApiProperty({
    description: 'Google ID token issued by Google Identity Services SDK',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Google ID token is required' })
  idToken!: string;

  @ApiPropertyOptional({
    description: 'Store name required for initial vendor onboarding via Google',
    example: 'Gadget Haven',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  storeName?: string;

  @ApiPropertyOptional({
    description: 'Optional store description',
    example: 'Premium electronics and accessories',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  storeDescription?: string;

  @ApiPropertyOptional({
    description: 'Business phone with international country code',
    example: '+2349064786655',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone number must include international country code (e.g. +2349064786655)',
  })
  businessPhone?: string;

  @ApiPropertyOptional({
    description: 'Business contact email',
    example: 'contact@gadgethaven.com',
  })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;
}
