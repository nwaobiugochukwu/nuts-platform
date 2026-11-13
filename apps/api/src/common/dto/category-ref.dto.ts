import { ApiProperty } from '@nestjs/swagger';

/**
 * Category Reference DTO
 * Used in product responses to reference the category.
 * Fetch: id, name, slug
 */
export class CategoryRefDto {
  @ApiProperty({
    description: 'Unique identifier of the category',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the category',
    example: 'Leather Goods',
  })
  name!: string;

  @ApiProperty({
    description: 'URL-friendly category slug',
    example: 'leather-goods',
  })
  slug!: string;
}
