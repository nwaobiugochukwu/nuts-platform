import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class TrackEventDto {
  @IsIn(['product_view', 'search'])
  event!: 'product_view' | 'search';

  @ValidateIf((event: TrackEventDto) => event.event === 'product_view')
  @IsUUID()
  productId?: string;

  // Stable across retries of one page visit. Optional for older clients; the
  // service creates an ID when it is absent.
  @IsOptional()
  @IsUUID()
  id?: string;

  @ValidateIf((event: TrackEventDto) => event.event === 'search')
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  query?: string;

  @ValidateIf((event: TrackEventDto) => event.event === 'search')
  @IsInt()
  @Min(0)
  resultsCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  visitorId?: string;
}
