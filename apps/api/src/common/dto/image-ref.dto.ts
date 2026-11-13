import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Image Reference DTO
 * Used in product and variant responses to reference images.
 * Fetch: id, url, position (optional)
 */
export class ImageRefDto {
  @ApiProperty({
    description: 'Unique identifier of the image',
    example: 'img-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'URL of the image',
    example: 'https://cdn.example.com/products/product-1.jpg',
  })
  url!: string;

  @ApiPropertyOptional({
    description: 'Display position/order of the image',
    example: 0,
  })
  position?: number;
}
