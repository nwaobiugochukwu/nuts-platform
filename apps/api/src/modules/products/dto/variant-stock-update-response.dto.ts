import { ApiProperty } from '@nestjs/swagger';

export class VariantStockUpdateResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the variant',
    example: 'v1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Updated stock quantity after the adjustment',
    example: 42,
  })
  stock!: number;

  @ApiProperty({
    description:
      'Whether the variant is available for purchase after this change',
    example: true,
  })
  inStock!: boolean;

  @ApiProperty({
    description:
      'Human-readable inventory status (e.g. "In stock", "Few items left", "Out of stock")',
    example: 'In stock',
  })
  stockStatus!: string;

  @ApiProperty({
    description: 'Timestamp when the stock was last updated',
    example: '2025-06-13T14:30:00.000Z',
  })
  updatedAt!: Date;
}
