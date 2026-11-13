import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VendorSummaryDto {
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
    description: 'URL of the store logo image (nullable)',
    example: 'https://cdn.example.com/logos/artisan-leather-co.png',
  })
  storeLogoUrl!: string | null;

  @ApiPropertyOptional({
    description: 'Description of the vendor store',
    example: 'Premium handcrafted leather goods',
  })
  storeDescription?: string;

  @ApiPropertyOptional({
    description: 'Email address of the vendor',
    example: 'vendor@example.com',
  })
  email?: string;
}
