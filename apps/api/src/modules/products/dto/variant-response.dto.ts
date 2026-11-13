import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VariantOptionDto } from '@api/common/dto/variant-option.dto';

class VariantProductRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional()
  imageUrl?: string | null;
}

export class VariantSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: () => VariantOptionDto,
    isArray: true,
  })
  options!: VariantOptionDto[];

  @ApiProperty()
  stock!: number;

  @ApiProperty()
  inStock!: boolean;

  @ApiProperty()
  stockStatus!: string;

  @ApiProperty({
    type: String,
    isArray: true,
  })
  images!: string[];

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  isDeleted!: boolean;

  @ApiPropertyOptional()
  deletedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class VariantResponseDto extends VariantSummaryDto {
  @ApiPropertyOptional({
    type: () => VariantProductRefDto,
  })
  product?: VariantProductRefDto;
}

export class ProductVariantListResponseDto {
  @ApiProperty({
    type: () => VariantSummaryDto,
    isArray: true,
  })
  variants!: VariantSummaryDto[];

  @ApiProperty({
    type: () => VariantProductRefDto,
  })
  product!: VariantProductRefDto;
}

export class AllVariantsResponseDto {
  @ApiProperty({
    type: () => VariantSummaryDto,
    isArray: true,
  })
  data!: VariantSummaryDto[];

  @ApiProperty()
  meta!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export class VariantStockUpdateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  stock!: number;

  @ApiProperty()
  inStock!: boolean;

  @ApiProperty()
  stockStatus!: string;

  @ApiProperty()
  updatedAt!: Date;
}
