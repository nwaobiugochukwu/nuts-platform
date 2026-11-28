import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateStockDto {
  @ApiProperty({
    description:
      'Amount to add (positive) or remove (negative) from current stock',
    example: 10,
  })
  @IsInt()
  @IsNotEmpty()
  @Type(() => Number)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Reason for the stock adjustment (visible in stock history)',
    example: 'Inventory re-count',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      'An id for this one adjustment. If the same id is sent again (a retry or a double click) the adjustment is not applied twice; the current stock is returned instead.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
