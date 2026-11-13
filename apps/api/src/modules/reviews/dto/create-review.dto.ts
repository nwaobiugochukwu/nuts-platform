import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 5, description: 'Rating from 1 to 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    example: 'Great product!',
    description: 'Optional comment',
  })
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiProperty({ description: 'The ID of the product being reviewed' })
  @IsString()
  @IsNotEmpty()
  productId!: string;
}

export class ReviewResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rating!: number;
  @ApiPropertyOptional() comment?: string | null;
  @ApiProperty() productId!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() userFirstName?: string | null;
  @ApiPropertyOptional() userLastName?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ProductReviewsMetaDto {
  @ApiProperty({ description: 'Total number of active reviews', example: 3 })
  total!: number;

  @ApiProperty({
    description: 'Average rating rounded to 1 decimal place',
    example: 4.7,
  })
  averageRating!: number;

  @ApiProperty({
    description: 'Count of reviews per rating star (1 through 5)',
    example: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 },
  })
  ratingBreakdown!: Record<number, number>;
}

export class ProductReviewsResponseDto {
  @ApiProperty({
    description: 'List of review items',
    type: [ReviewResponseDto],
  })
  data!: ReviewResponseDto[];

  @ApiProperty({
    description: 'Review summary metadata',
    type: ProductReviewsMetaDto,
  })
  meta!: ProductReviewsMetaDto;
}

export type ProductReviewsSummaryDto = ProductReviewsResponseDto;
