import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VendorStoreDto {
  @ApiProperty({ description: 'Display name of the store' })
  storeName!: string;

  @ApiProperty({ description: 'URL-friendly store slug' })
  storeSlug!: string;

  @ApiProperty({ description: 'Description of the store' })
  storeDescription!: string;

  @ApiPropertyOptional({ description: 'URL of the store logo', nullable: true })
  storeLogoUrl!: string | null;

  @ApiPropertyOptional({
    description: 'Alt text for the store logo',
    nullable: true,
  })
  storeLogoAltText!: string | null;

  @ApiProperty({ description: 'Whether the vendor is verified' })
  isVerified!: boolean;
}
