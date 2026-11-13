import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import {
  OrderCustomerDto,
  OrderStatusHistoryDto,
} from './admin-order-response.dto';
import { OrderItemResponseDto } from './order-response.dto';

export class VendorOrderResponseDto {
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
    description: 'Discount code used, if any',
    example: 'SAVE10',
    nullable: true,
  })
  discountCode?: string | null;

  @ApiPropertyOptional({
    description: 'Referral code used, if any',
    example: 'REF-JOHN',
    nullable: true,
  })
  referralCode?: string | null;

  @ApiProperty({
    description: 'Order line items',
    type: [OrderItemResponseDto],
  })
  items!: OrderItemResponseDto[];

  @ApiPropertyOptional({
    description: 'Snapshot shipping address used for the order',
    example: '123 Main St, Lagos, Nigeria',
    nullable: true,
  })
  shippingAddress?: string | null;

  @ApiProperty({
    description:
      'Whether the order stock has been restored (for cancelled orders)',
    example: false,
  })
  stockRestored!: boolean;

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

  @ApiProperty({
    description: 'Customer who placed the order',
    type: OrderCustomerDto,
  })
  customer!: OrderCustomerDto;

  @ApiProperty({
    description: 'Order status change history',
    type: [OrderStatusHistoryDto],
  })
  statusHistory!: OrderStatusHistoryDto[];
}
