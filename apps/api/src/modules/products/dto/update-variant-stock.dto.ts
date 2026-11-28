import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVariantStockDto {
  @ApiProperty({
    description:
      'Stock adjustment. Positive values add stock. Negative values remove stock.',
    example: -2,
  })
  @IsInt()
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Reason for the stock adjustment.',
    example: 'Inventory recount',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
