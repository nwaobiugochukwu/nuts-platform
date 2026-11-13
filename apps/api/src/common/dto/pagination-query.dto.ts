import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ToNumberDefault } from '@api/common/decorators/to-number.decorator';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
  })
  @ToNumberDefault(1)
  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({
    example: 10,
    default: 10,
  })
  @ToNumberDefault(10)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 10;
}
