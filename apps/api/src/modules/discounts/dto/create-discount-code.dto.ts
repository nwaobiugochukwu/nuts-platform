import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { DiscountCodeType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
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
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DISCOUNT_CODE_PATTERN,
  DISCOUNT_MAX_LIST_ITEMS,
} from '@api/common/constants/discount.constants';

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
  @MinLength(3)
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @Matches(DISCOUNT_CODE_PATTERN, {
    message:
      'code may only contain letters, numbers, hyphens and underscores (3-50 characters).',
  })
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
  @ArrayMaxSize(DISCOUNT_MAX_LIST_ITEMS)
  @IsUUID('4', { each: true })
  applicableProductIds?: string[];

  @ApiPropertyOptional({
    description:
      'Category IDs this discount code applies to. Empty or omitted applies to all categories.',
    type: [String],
    example: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(DISCOUNT_MAX_LIST_ITEMS)
  @IsUUID('4', { each: true })
  applicableCategoryIds?: string[];

  @ApiPropertyOptional({
    description: 'Whether the discount applies platform-wide.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  platformwide?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether the discount is exclusively for first-time shoppers who have never completed an order.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;
}

/** Admin codes may be platform-wide. */
export class CreateAdminDiscountCodeDto extends CreateDiscountCodeDto {}

/**
 * Vendor codes can never be platform-wide: the field is not accepted at all
 * (the global ValidationPipe uses forbidNonWhitelisted), so a vendor cannot
 * opt into discounting other stores' products.
 */
export class CreateVendorDiscountCodeDto extends OmitType(
  CreateDiscountCodeDto,
  ['platformwide'] as const,
) {}

export class ListDiscountCodesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;
}
