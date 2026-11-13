import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminVendorResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiProperty() storeName!: string;
  @ApiProperty() storeSlug!: string;
  @ApiProperty() storeDescription!: string;
  @ApiPropertyOptional({ nullable: true }) businessPhone!: string | null;
  @ApiProperty() businessEmail!: string;
  @ApiPropertyOptional({ nullable: true }) storeLogoUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) storeLogoAltText!: string | null;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isApproved!: boolean;
  @ApiPropertyOptional({ nullable: true }) deactivatedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) deactivatedReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
