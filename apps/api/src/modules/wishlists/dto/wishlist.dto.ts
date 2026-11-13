import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AddToWishlistDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantId?: string;
}

export class WishlistResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() productId!: string;
  @ApiPropertyOptional({ nullable: true }) variantId?: string | null;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiProperty() productPrice!: number;
  @ApiPropertyOptional({ nullable: true }) productImage?: string | null;
  @ApiPropertyOptional({ nullable: true }) variantName?: string | null;
  @ApiProperty() createdAt!: Date;
}
