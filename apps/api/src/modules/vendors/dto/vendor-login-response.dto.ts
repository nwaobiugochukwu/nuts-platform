import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VendorLoginResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the vendor',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: "Display name of the vendor's store returned after login",
    example: 'My Awesome Store',
  })
  storeName!: string;

  @ApiProperty({
    description: 'URL-friendly slug for the store returned after login',
    example: 'my-awesome-store',
  })
  storeSlug!: string;

  @ApiPropertyOptional({
    description: 'Short description of the store returned after login',
    example: 'Handcrafted goods made with love and care.',
  })
  storeDescription!: string | null;
}
