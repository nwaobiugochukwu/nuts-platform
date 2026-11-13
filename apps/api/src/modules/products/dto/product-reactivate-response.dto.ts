import { ApiProperty } from '@nestjs/swagger';

export class ProductReactivateResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the reactivated product',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'URL-friendly slug of the product',
    example: 'handcrafted-wooden-bowl',
  })
  slug!: string;

  @ApiProperty({
    description: 'Whether the product is active after reactivation',
    example: true,
  })
  isActive!: boolean;

  @ApiProperty({
    description: 'Timestamp when the product was reactivated',
    example: '2025-06-13T14:30:00.000Z',
  })
  updatedAt!: Date;
}
