import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { VariantOptionDto } from '@api/modules/shared/dto/variant-option.dto';

class OrderProductSnapshotDto {
  @ApiProperty({ description: 'Product name at time of order' })
  name!: string;

  @ApiProperty({ description: 'Product SKU at time of order' })
  sku!: string;

  @ApiProperty({ description: 'Product image URLs at time of order' })
  images!: string[];
}

class OrderVariantSnapshotDto {
  @ApiProperty({
    description: 'Variant options snapshot as array of {name, value} pairs',
    type: () => VariantOptionDto,
    isArray: true,
    example: [
      { name: 'size', value: 'M' },
      { name: 'color', value: 'Black' },
    ],
  })
  options!: { name: string; value: string }[];
}

export class OrderItemResponseDto {
  @ApiProperty({ description: 'Product ID' })
  productId!: string;

  @ApiProperty({
    description: 'Variant ID (nullable for non-variant products)',
  })
  variantId?: string | null;

  @ApiProperty({ description: 'Quantity purchased' })
  quantity!: number;

  @ApiProperty({ description: 'Price per unit at time of order' })
  unitPrice!: number;

  @ApiProperty({ description: 'Total price for this line item' })
  totalPrice!: number;

  @ApiProperty({ type: () => OrderProductSnapshotDto })
  productSnapshot!: OrderProductSnapshotDto;

  @ApiPropertyOptional({ type: () => OrderVariantSnapshotDto, nullable: true })
  variantSnapshot?: OrderVariantSnapshotDto | null;
}

export class OrderResponseDto {
  @ApiProperty({ description: 'Unique identifier of the order' })
  id!: string;

  @ApiProperty({ description: 'Human-readable order number' })
  orderNumber!: string;

  @ApiProperty({ description: 'Current order status', enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ description: 'Total order amount' })
  totalAmount!: number;

  @ApiProperty({ description: 'Discount amount applied' })
  discountAmount!: number;

  @ApiProperty({ description: 'Referral discount amount' })
  referralDiscountAmount!: number;

  @ApiProperty({ description: 'Final amount after all discounts' })
  finalAmount!: number;

  @ApiPropertyOptional({ description: 'Discount code used', nullable: true })
  discountCode?: string | null;

  @ApiPropertyOptional({ description: 'Referral code used', nullable: true })
  referralCode?: string | null;

  @ApiProperty({
    description: 'Line items with snapshots',
    type: () => OrderItemResponseDto,
    isArray: true,
  })
  items!: OrderItemResponseDto[];

  @ApiPropertyOptional({
    description: 'Shipping address snapshot',
    nullable: true,
  })
  shippingAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  shippingAddressId?: string | null;

  @ApiProperty({ description: 'Timestamp when the order was created' })
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      'Timestamp when pending payment window expires, after which items are released',
    nullable: true,
  })
  paymentExpiresAt?: Date | null;
}
