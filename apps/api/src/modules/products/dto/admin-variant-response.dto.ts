import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VariantOptionDto } from '@api/common/dto/variant-option.dto';

export class AdminVariantResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({
    description: 'Variant options as array of {name, value} pairs',
    type: () => VariantOptionDto,
    isArray: true,
    example: [
      { name: 'size', value: 'M' },
      { name: 'color', value: 'Black' },
    ],
  })
  options!: VariantOptionDto[];

  @ApiProperty() stock!: number;
  @ApiProperty() inStock!: boolean;
  @ApiProperty() stockStatus!: string;
  @ApiProperty() images!: string[];

  @ApiPropertyOptional({ description: 'Parent product summary' })
  product?: {
    id: string;
    name: string;
    slug: string;
    imageUrl?: string | null;
  };

  @ApiProperty() isActive!: boolean;
  @ApiProperty() isDeleted!: boolean;
  @ApiPropertyOptional() deletedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
