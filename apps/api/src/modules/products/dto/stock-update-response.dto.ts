import { ApiProperty } from '@nestjs/swagger';

export class StockUpdateResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the updated product',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'URL-friendly slug of the product',
    example: 'handcrafted-wooden-bowl',
  })
  slug!: string;

  @ApiProperty({
    description: 'Updated stock quantity after the adjustment',
    example: 42,
  })
  stock!: number;

  @ApiProperty({
    description:
      'Whether the product is available for purchase after the update',
    example: true,
  })
  inStock!: boolean;

  @ApiProperty({
    description: 'Updated human-readable inventory status label',
    example: 'In stock',
  })
  stockStatus!: string;

  @ApiProperty({
    description: 'Timestamp when the stock was last updated',
    example: '2025-06-13T14:30:00.000Z',
  })
  updatedAt!: Date;
}
