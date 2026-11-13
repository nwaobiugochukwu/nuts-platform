import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WalletTransactionReason, WalletTransactionType } from '@prisma/client';

export class WalletTransactionResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the wallet transaction',
    example: 'wtx-9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6',
  })
  id!: string;

  @ApiProperty({
    description:
      'Transaction amount (positive for credits, negative for debits)',
    example: 50.0,
  })
  amount!: number;

  @ApiProperty({
    description: 'Type of transaction: credit (inflow) or debit (outflow)',
    enum: WalletTransactionType,
    example: WalletTransactionType.CREDIT,
  })
  type!: WalletTransactionType;

  @ApiProperty({
    description: 'Reason or source category for the transaction',
    enum: WalletTransactionReason,
    example: WalletTransactionReason.SALE,
  })
  reason!: WalletTransactionReason;

  @ApiPropertyOptional({
    description:
      'Reference ID linking this transaction to a related entity (e.g. order ID)',
    example: 'ord-9f8e7d6c-5b4a-3c2d-1e0f-a1b2c3d4e5f6',
    nullable: true,
  })
  referenceId!: string | null;

  @ApiProperty({
    description: 'Timestamp when the transaction occurred',
    example: '2025-06-14T10:30:00.000Z',
  })
  createdAt!: Date;
}
