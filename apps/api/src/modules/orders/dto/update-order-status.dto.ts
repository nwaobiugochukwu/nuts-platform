import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({
    description:
      'Optional note recorded in order status history (e.g. cancel reason)',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
