import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { Type } from 'class-transformer';

export const RECOMMENDATION_EVENT_TYPES = [
  'IMPRESSION',
  'CLICK',
  'DISMISS',
  'CATEGORY_VIEW',
] as const;

export const RECOMMENDATION_SURFACES = [
  'HOME_FOR_YOU',
  'HOME_MARKETPLACE_MIX',
  'HOME_RECENTLY_VIEWED',
  'HOME_NEW_IN_INTERESTS',
  'HOME_MEET_VENDORS',
  'HOME_FOLLOWING',
  'HOME_NEW_ARRIVALS',
  'HOME_TRENDING',
  'PRODUCT_RELATED',
  'CATEGORY_POPULAR',
  'CATEGORY_BROWSE',
  'DISCOVERY',
] as const;

export class RecommendationEventDto {
  @IsUUID()
  id!: string;

  @IsIn(RECOMMENDATION_EVENT_TYPES)
  eventType!: (typeof RECOMMENDATION_EVENT_TYPES)[number];

  @IsIn(RECOMMENDATION_SURFACES)
  surface!: (typeof RECOMMENDATION_SURFACES)[number];

  @IsUUID()
  requestId!: string;

  @IsString()
  @MaxLength(40)
  rankerVersion!: string;

  @IsInt()
  @Min(0)
  @Max(200)
  position!: number;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsUUID()
  sessionId!: string;
}

export class RecommendationEventsBatchDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecommendationEventDto)
  events!: RecommendationEventDto[];
}

export class GuestBehaviorEventDto {
  @IsIn(['product_view', 'search'])
  event!: 'product_view' | 'search';

  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsUUID()
  visitorId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  // Stable across retries of one page visit. Optional for older clients.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  resultsCount?: number;
}
