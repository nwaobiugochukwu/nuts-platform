import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionResponseDto } from './wallet-transaction-response.dto';

export class UserWalletResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the wallet',
    example: 'wallet-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  id!: string;

  @ApiProperty({
    description: 'Current wallet balance',
    example: 150.0,
  })
  balance!: number;

  @ApiProperty({
    description: 'Timestamp when the wallet was created',
    example: '2025-01-01T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the wallet was last updated',
    example: '2025-06-14T10:30:00.000Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Most recent wallet transactions (up to 20)',
    type: [WalletTransactionResponseDto],
  })
  transactions!: WalletTransactionResponseDto[];
}
