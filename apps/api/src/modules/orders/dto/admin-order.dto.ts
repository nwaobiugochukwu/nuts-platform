import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

class AdminCustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
}

class AdminPaymentDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true }) transactionId!: string | null;
}

class AdminOrderItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() price!: number;
}

export class AdminOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() discountAmount!: number;
  @ApiProperty() finalAmount!: number;
  @ApiPropertyOptional({ nullable: true }) discountCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) shippingAddress!: string | null;
  @ApiProperty() stockRestored!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: AdminCustomerDto }) customer!: AdminCustomerDto;
  @ApiPropertyOptional({ type: AdminPaymentDto, nullable: true })
  payment!: AdminPaymentDto | null;
  @ApiProperty({ type: [AdminOrderItemDto] }) items!: AdminOrderItemDto[];
  @ApiProperty() paymentStatus!: string;
  @ApiProperty() platformFee!: number;
  @ApiProperty() vendorRevenue!: number;
}
