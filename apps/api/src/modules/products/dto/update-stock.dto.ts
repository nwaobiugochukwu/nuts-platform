import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
