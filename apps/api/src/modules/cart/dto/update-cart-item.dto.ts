import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    description:
      'Quantity to increment (positive) or decrement (negative) by. Decrementing to 0 or below removes the item.',
  })
  @Type(() => Number)
  @IsInt()
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'Optional variant ID for product variants. Preferred over the variantId query parameter.',
  })
  @IsOptional()
  @IsString()
  variantId?: string;
}
