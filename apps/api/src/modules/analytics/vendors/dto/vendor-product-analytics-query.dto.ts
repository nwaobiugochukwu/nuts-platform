import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { AnalyticsQueryDto } from '../../dto/analytics-query.dto';

export class VendorProductAnalyticsQueryDto extends AnalyticsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
