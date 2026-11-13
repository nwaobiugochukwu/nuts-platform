import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';

export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiPropertyOptional({
    description:
      'Latest provider refund lifecycle state, when a refund exists.',
    enum: [
      'REQUESTED',
      'PENDING',
      'PROCESSING',
      'NEEDS_ATTENTION',
      'FAILED',
      'PROCESSED',
    ],
  })
  refundStatus?: string;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ nullable: true }) transactionReference!: string | null;
  @ApiPropertyOptional({ nullable: true }) paymentLink!: string | null;
  @ApiPropertyOptional({ nullable: true }) paymentMethod!: string | null;
  @ApiProperty() orderId!: string;
  @ApiProperty() createdAt!: Date;
}

export class InitializePaymentResponseDto {
  @ApiProperty({ description: 'Paystack authorization URL' })
  authorizationUrl!: string;

  @ApiPropertyOptional({ description: 'Paystack authorization URL alias' })
  authorization_url?: string;

  @ApiPropertyOptional({
    description: 'Paystack access code for the in-page Popup V2 flow',
  })
  accessCode?: string;

  @ApiProperty({ description: 'Paystack transaction reference' })
  reference!: string;

  @ApiProperty({ description: 'Payment record ID' })
  paymentId!: string;
}

export class PaystackCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trxref?: string;
}
