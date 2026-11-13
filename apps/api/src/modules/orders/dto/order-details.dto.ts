import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class OrderItemDetailDto {
  @ApiProperty() productId!: string;
  @ApiPropertyOptional({ nullable: true }) variantId!: string | null;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiPropertyOptional({ nullable: true }) variantName!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() price!: number;
}

export class OrderDetailsDto {
  @ApiProperty() orderNumber!: string;
  @ApiProperty() subtotal!: number;
  @ApiProperty() shippingFee!: number;
  @ApiProperty() discountAmount!: number;
  @ApiProperty() totalAmount!: number;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ type: [OrderItemDetailDto] }) items!: OrderItemDetailDto[];
  @ApiProperty() createdAt!: Date;
}
