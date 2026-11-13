import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({ description: 'The payment ID to refund' })
  @IsUUID()
  @IsNotEmpty()
  paymentId!: string;

  @ApiProperty({
    description:
      'Optional amount for compatibility. If provided, it must equal the full payment amount; partial refunds remain unsupported.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;
}
