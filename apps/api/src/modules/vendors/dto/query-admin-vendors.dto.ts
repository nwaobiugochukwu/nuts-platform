import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ToBoolean } from '@api/common/decorators/to-boolean.decorator';

export class QueryAdminVendorsDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Text search across email, store name, and store slug',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by active state' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filter by approval state' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isApproved?: boolean;

  @ApiPropertyOptional({ description: 'Filter by verification state' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isVerified?: boolean;
}
