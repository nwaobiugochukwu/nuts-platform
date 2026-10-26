import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CheckoutItemSnapshot {
  @ApiProperty({ description: 'Product name at time of order' })
  productName!: string;

  @ApiProperty({ description: 'Variant name at time of order, if applicable' })
  variantName?: string;

  @ApiProperty({ description: 'Quantity ordered' })
  quantity!: number;

  @ApiProperty({ description: 'Unit price' })
  unitPrice!: number;
}

export class CheckoutResponseDto {
  @ApiProperty({ description: 'Order ID' })
  id!: string;

  @ApiProperty({ description: 'Order number' })
  orderNumber!: string;

  @ApiProperty({ description: 'Order status' })
  status!: string;

  @ApiProperty({ description: 'Total amount' })
  totalAmount!: number;

  @ApiProperty({ description: 'Discount amount' })
  discountAmount!: number;

  @ApiProperty({ description: 'Referral discount amount' })
  referralDiscountAmount!: number;

  @ApiProperty({ description: 'Final amount' })
  finalAmount!: number;

  @ApiPropertyOptional({ description: 'Discount code used', nullable: true })
  discountCode?: string | null;

  @ApiPropertyOptional({ description: 'Referral code used', nullable: true })
  referralCode?: string | null;

  @ApiProperty({
    description: 'Order items with snapshots',
    type: [CheckoutItemSnapshot],
  })
  items!: CheckoutItemSnapshot[];

  @ApiPropertyOptional({
    description: 'Shipping address snapshot',
    nullable: true,
  })
  shippingAddress?: string | null;

  @ApiPropertyOptional({
    description: 'Paystack authorization URL',
    nullable: true,
  })
  authorizationUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Paystack authorization URL alias',
    nullable: true,
  })
  authorization_url?: string | null;

  @ApiPropertyOptional({
    description: 'Paystack access code for the in-page Popup V2 flow',
    nullable: true,
  })
  paystackAccessCode?: string | null;

  @ApiPropertyOptional({ description: 'Payment ID', nullable: true })
  paymentId?: string | null;

  @ApiPropertyOptional({
    description: 'Paystack transaction reference',
    nullable: true,
  })
  paymentReference?: string | null;

  @ApiProperty({ description: 'Timestamp when the order was created' })
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      'Timestamp when pending payment window expires, after which items are released',
    nullable: true,
  })
  paymentExpiresAt?: Date | null;
}
