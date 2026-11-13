import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Vendor Reference DTO
 * Used in product responses to reference the vendor (store owner).
 * Fetch: id, storeName, storeSlug, storeLogoUrl
 */
export class VendorRefDto {
  @ApiProperty({
    description: 'Unique identifier of the vendor',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the vendor store',
    example: 'Artisan Leather Co.',
  })
  storeName!: string;

  @ApiProperty({
    description: 'URL-friendly slug of the vendor store',
    example: 'artisan-leather-co',
  })
  storeSlug!: string;

  @ApiPropertyOptional({
    description: 'URL of the store logo image',
    example: 'https://cdn.example.com/logos/artisan-leather-co.png',
  })
  storeLogoUrl?: string | null;
}
