import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
