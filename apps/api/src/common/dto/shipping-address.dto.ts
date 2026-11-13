import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../decorators/string-trim.decorator';

export class ShippingAddressDto {
  @ApiProperty({ description: 'Full name of the delivery recipient' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({
    description:
      'Phone number for delivery contact in E.164 international format',
    example: '+2349064786655',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone number must include international country code (e.g. +2349064786655)',
  })
  @MaxLength(30)
  phone!: string;

  @ApiProperty({ description: 'Street address' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  street!: string;

  @ApiProperty({ description: 'City' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ description: 'State or region' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state!: string;

  @ApiPropertyOptional({
    description: 'Country name',
    example: 'Nigeria',
    default: 'Nigeria',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country?: string;
}
