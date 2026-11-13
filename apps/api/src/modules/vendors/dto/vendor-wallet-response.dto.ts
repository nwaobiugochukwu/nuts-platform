import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionResponseDto } from '@api/modules/wallet/dto/wallet-transaction-response.dto';

export class VendorWalletResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the wallet',
    example: 'wallet_a1b2c3d4e5f6',
  })
  id!: string;

  @ApiProperty({
    description: 'Current settled balance available for payout',
    example: 200.0,
  })
  balance!: number;

  @ApiProperty({
    description: 'Pending (unsettled) balance not yet available for payout',
    example: 85.0,
  })
  pendingBalance!: number;

  @ApiProperty({
    description: 'Total lifetime earnings accumulated by the vendor',
    example: 5000.0,
  })
  lifetimeEarnings!: number;

  @ApiProperty({
    description: 'Timestamp when the wallet was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the wallet was last updated',
    example: '2024-06-10T14:22:00.000Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Most recent wallet transactions (limited to the last 20)',
    type: [WalletTransactionResponseDto],
  })
  transactions!: WalletTransactionResponseDto[];
}
