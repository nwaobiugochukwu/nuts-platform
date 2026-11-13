import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** Preset ranges accepted by admin and vendor analytics endpoints. */
export const ANALYTICS_RANGES = ['7d', '30d', '90d', '1y'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Days to look back for each preset range. */
export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      'Preset range for the analytics window. Ignored when startDate/endDate are provided.',
    enum: ANALYTICS_RANGES,
    default: '30d',
  })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;

  @ApiPropertyOptional({
    description:
      'Start date (ISO timestamp). Dashboard calendar periods use Africa/Lagos boundaries; the maximum accepted range is 730 days.',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End date (ISO timestamp). Dashboard calendar periods use Africa/Lagos boundaries; the maximum accepted range is 730 days.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of top results to return',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  top?: number;
}
