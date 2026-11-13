import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountCodeType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Base DTO for creating discount codes.
 * Contains all shared fields, normalization transforms, and validation rules.
 */
export class CreateDiscountCodeDto {
  @ApiProperty({
    description:
      'Unique discount code string. Automatically trimmed and converted to uppercase.',
    example: 'SAVE20',
  })
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  code!: string;

  @ApiPropertyOptional({
    description: 'Human-readable description of the discount code terms.',
    example: '20% off all eligible products',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    enum: DiscountCodeType,
    description: 'Discount calculation type: PERCENTAGE or FIXED',
    example: DiscountCodeType.PERCENTAGE,
  })
  @IsEnum(DiscountCodeType)
  type!: DiscountCodeType;

  @ApiProperty({
    description:
      'Discount value. Represents the percentage (1-100) for PERCENTAGE or flat amount for FIXED.',
    example: 20,
  })
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  value!: number;

  @ApiPropertyOptional({
    description:
      'Maximum discount amount cap. Only applies to PERCENTAGE discounts.',
    example: 5000,
    nullable: true,
  })
  @IsOptional()
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  maxDiscountAmount?: number | null;

  @ApiPropertyOptional({
    description:
      'Minimum order subtotal required for this discount code to be applied.',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({
    description:
      'Maximum total number of successful redemptions across all users. Omit or null for unlimited.',
    example: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  usageLimit?: number | null;

  @ApiPropertyOptional({
    description:
      'Maximum number of redemptions permitted per individual user. Omit or null for unlimited.',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  perUserUsageLimit?: number | null;

  @ApiPropertyOptional({
    description: 'Whether the discount code is active upon creation.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'ISO-8601 timestamp when the discount code becomes valid.',
    example: '2026-01-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({
    description: 'ISO-8601 timestamp when the discount code expires.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({
    description:
      'Product IDs this discount code applies to. Empty or omitted applies to all products within scope.',
    type: [String],
    example: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  applicableProductIds?: string[];

  @ApiPropertyOptional({
    description: 'Whether the discount applies platform-wide.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  platformwide?: boolean;
}

export {
  CreateDiscountCodeDto as CreateAdminDiscountCodeDto,
  CreateDiscountCodeDto as CreateVendorDiscountCodeDto,
};
