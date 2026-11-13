import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RECOMMENDATION_SURFACES } from '@api/modules/analytics/tracking/recommendation-events.dto';

export class CartRecommendationContextDto {
  @IsUUID()
  requestId!: string;

  @IsIn(RECOMMENDATION_SURFACES)
  surface!: (typeof RECOMMENDATION_SURFACES)[number];

  @IsString()
  @MaxLength(40)
  rankerVersion!: string;

  @IsInt()
  @Min(0)
  @Max(200)
  position!: number;

  @IsUUID()
  sessionId!: string;
}

export class AddToCartQuantityDto {
  @ApiProperty({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'Optional variant ID for product variants. Preferred over the variantId query parameter.',
  })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiPropertyOptional({ description: 'Recommendation attribution context' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CartRecommendationContextDto)
  recommendationContext?: CartRecommendationContextDto;
}
