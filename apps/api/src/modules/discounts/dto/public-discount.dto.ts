import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountCodeScope, DiscountCodeType } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class PublicPlatformPromoDto {
  @ApiProperty({ description: 'Discount code ID', example: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Coupon code', example: 'SAVE10' })
  code!: string;

  @ApiPropertyOptional({
    description: 'Campaign description',
    example: '10% off for all shoppers',
  })
  description?: string | null;

  @ApiProperty({ enum: DiscountCodeType, example: DiscountCodeType.PERCENTAGE })
  type!: DiscountCodeType;

  @ApiProperty({
    description: 'Value (percentage or fixed amount in NGN)',
    example: 10,
  })
  value!: number;

  @ApiPropertyOptional({
    description: 'Max discount cap in NGN',
    example: 25000,
  })
  maxDiscountAmount?: number | null;

  @ApiProperty({ description: 'Minimum spend required', example: 50000 })
  minOrderAmount!: number;

  @ApiPropertyOptional({
    description: 'Campaign scheduled start date and time',
    example: '2026-11-20T00:00:00.000Z',
  })
  startsAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Expiration date',
    example: '2026-12-31T23:59:59.000Z',
  })
  expiresAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Whether this promo is exclusively for first-time buyers',
    example: true,
  })
  isFirstOrderOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'True when the offer applies automatically (no code to enter or claim).',
  })
  autoApply?: boolean;
}

export class ProductVoucherSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'TECH15' })
  code!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ enum: DiscountCodeType })
  type!: DiscountCodeType;

  @ApiProperty({ example: 15 })
  value!: number;

  @ApiProperty({ enum: DiscountCodeScope })
  scope!: DiscountCodeScope;

  @ApiProperty({ example: 30000 })
  minOrderAmount!: number;

  @ApiPropertyOptional({ example: 20000 })
  maxDiscountAmount?: number | null;

  @ApiProperty({
    description: 'Estimated savings on single quantity of base price in NGN',
    example: 27750,
  })
  estimatedSavings!: number;

  @ApiPropertyOptional()
  expiresAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Calculated deal price for this item if voucher is applied',
    example: 45000,
  })
  dealPrice?: number;

  @ApiPropertyOptional({
    description:
      'Whether this product alone satisfies the voucher minimum order spend',
    example: true,
  })
  isApplicable?: boolean;

  @ApiPropertyOptional({
    description:
      'Amount needed to reach the minimum order requirement for this voucher',
    example: 0,
  })
  minOrderShortfall?: number;

  @ApiPropertyOptional({
    description: 'Whether this voucher is exclusively for first-time shoppers',
    example: false,
  })
  isFirstOrderOnly?: boolean;

  @ApiPropertyOptional({
    description:
      'True when the offer applies automatically at checkout (no code to enter or claim).',
  })
  autoApply?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum number of eligible items required ("buy 3+").',
    nullable: true,
  })
  minQuantity?: number | null;
}

export class PublicProductDealDto {
  @ApiProperty({ example: 'uuid' })
  productId!: string;

  @ApiPropertyOptional({
    type: ProductVoucherSummaryDto,
    description:
      'Single highest-saving voucher immediately applicable to this product alone',
  })
  bestDiscount?: (ProductVoucherSummaryDto & { dealPrice: number }) | null;

  @ApiPropertyOptional({
    type: ProductVoucherSummaryDto,
    description:
      'Best conditional or unlockable voucher that applies when reaching minimum order spend',
  })
  unlockableDiscount?:
    | (ProductVoucherSummaryDto & {
        minOrderAmount: number;
        minOrderShortfall: number;
      })
    | null;

  @ApiProperty({
    type: [ProductVoucherSummaryDto],
    description: 'All applicable vouchers',
  })
  allVouchers!: ProductVoucherSummaryDto[];
}

export class BatchProductDiscountsDto {
  @ApiPropertyOptional({
    description: 'Single product ID to calculate deals and vouchers for',
    example: '1625d433-56d9-4443-80df-a4a6d7999b05',
  })
  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'List of product IDs to calculate discounts for (max 100)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(100)
  productIds?: string[];
}

export class QueryProductDealsDto extends BatchProductDiscountsDto {}
