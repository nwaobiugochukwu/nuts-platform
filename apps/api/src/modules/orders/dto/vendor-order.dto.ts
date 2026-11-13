import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

class CustomerInfoDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
}

class VendorOrderItemDto {
  @ApiProperty() productId!: string;
  @ApiPropertyOptional({ nullable: true }) variantId!: string | null;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiPropertyOptional({ nullable: true }) variantName!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() price!: number;
}

export class VendorOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() discountAmount!: number;
  @ApiProperty() finalAmount!: number;
  @ApiPropertyOptional({ nullable: true }) discountCode!: string | null;
  @ApiPropertyOptional({ nullable: true }) shippingAddress!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: CustomerInfoDto }) customer!: CustomerInfoDto;
  @ApiProperty({ type: [VendorOrderItemDto] }) items!: VendorOrderItemDto[];
  @ApiProperty() vendorRevenue!: number;
}
