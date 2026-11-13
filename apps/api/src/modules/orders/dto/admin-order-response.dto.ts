import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { OrderItemResponseDto } from './order-response.dto';
import { UserIdentitySummaryDto } from '@api/common/dto/user-identity-summary.dto';

export { UserIdentitySummaryDto as OrderCustomerDto };

export class OrderVendorDto {
  @ApiProperty({
    description: 'Unique identifier of the vendor',
    example: 'cr-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Vendor store name',
    example: 'Artisan Leather Co.',
  })
  storeName!: string;

  @ApiProperty({
    description: 'Vendor store slug',
    example: 'artisan-leather-co',
  })
  storeSlug!: string;
}

export class OrderPaymentDto {
  @ApiProperty({
    description: 'Unique identifier of the payment record',
    example: 'pay-7a8b9c0d-1e2f-4a3b-8c7d-9e0f1a2b3c4d',
  })
  id!: string;

  @ApiProperty({
    description: 'Current payment status',
    enum: PaymentStatus,
    example: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @ApiProperty({
    description: 'Payment amount',
    example: 164.98,
  })
  amount!: number;

  @ApiProperty({
    description: 'Payment currency code',
    example: 'NGN',
  })
  currency!: string;

  @ApiPropertyOptional({
    description: 'Payment gateway transaction reference',
    example: 'paystack_txn_abc123def456',
    nullable: true,
  })
  transactionId?: string | null;
}

export class AdminOrderItemResponseDto extends OrderItemResponseDto {
  @ApiPropertyOptional({
    description: 'Product SKU for inventory reference',
    example: 'TOTE-BAG-OS',
  })
  productSku?: string;
}

export class OrderStatusHistoryDto {
  @ApiProperty() id!: string;

  @ApiPropertyOptional({ nullable: true })
  fromStatus!: OrderStatus | null;

  @ApiProperty({ enum: OrderStatus })
  toStatus!: OrderStatus;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty() createdAt!: Date;

  @ApiPropertyOptional({ type: UserIdentitySummaryDto, nullable: true })
  changedBy!: UserIdentitySummaryDto | null;
}

export class AdminOrderResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the order',
    example: 'ord-9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6',
  })
  id!: string;

  @ApiProperty({
    description: 'Human-readable order number',
    example: 'ORD-20250614-XXXX',
  })
  orderNumber!: string;

  @ApiProperty({
    description: 'Current order status',
    enum: OrderStatus,
    example: OrderStatus.PENDING,
  })
  status!: OrderStatus;

  @ApiProperty({
    description: 'Current payment status',
    enum: PaymentStatus,
    example: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  @ApiProperty({
    description: 'Total order amount before discounts',
    example: 179.98,
  })
  totalAmount!: number;

  @ApiProperty({
    description: 'Discount amount applied to the order',
    example: 10.0,
  })
  discountAmount!: number;

  @ApiProperty({
    description: 'Referral discount amount applied',
    example: 5.0,
  })
  referralDiscountAmount!: number;

  @ApiProperty({
    description: 'Final amount after all discounts',
    example: 164.98,
  })
  finalAmount!: number;

  @ApiPropertyOptional({
    description: 'Discount code used for this order, if any',
    example: 'SAVE10',
    nullable: true,
  })
  discountCode?: string | null;

  @ApiPropertyOptional({
    description: 'Referral code used for this order, if any',
    example: 'REF-JOHN',
    nullable: true,
  })
  referralCode?: string | null;

  @ApiProperty({
    description: 'Platform fee charged on this order',
    example: 16.5,
  })
  platformFee!: number;

  @ApiProperty({
    description: 'Revenue share for the vendor(s)',
    example: 148.48,
  })
  vendorRevenue!: number;

  @ApiProperty({
    description: 'Customer who placed the order',
    type: UserIdentitySummaryDto,
  })
  customer!: UserIdentitySummaryDto;

  @ApiPropertyOptional({
    description: 'Vendor who owns the products in this order',
    type: OrderVendorDto,
    nullable: true,
  })
  vendor?: OrderVendorDto | null;

  @ApiPropertyOptional({
    description: 'Payment details for this order, if available',
    type: OrderPaymentDto,
    nullable: true,
  })
  payment?: OrderPaymentDto | null;

  @ApiPropertyOptional({
    description: 'Snapshot shipping address used for the order',
    example: '123 Main St, Lagos, Nigeria',
    nullable: true,
  })
  shippingAddress?: string | null;

  @ApiProperty({
    description: 'Whether stock has been restored',
    example: false,
  })
  stockRestored!: boolean;

  @ApiProperty({
    description: 'Order line items with admin details',
    type: [AdminOrderItemResponseDto],
  })
  items!: AdminOrderItemResponseDto[];

  @ApiProperty({
    description: 'Order status change history',
    type: [OrderStatusHistoryDto],
  })
  statusHistory!: OrderStatusHistoryDto[];

  @ApiProperty({
    description: 'Timestamp when the order was created',
    example: '2025-06-14T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the order was last updated',
    example: '2025-06-14T11:00:00.000Z',
  })
  updatedAt!: Date;
}
