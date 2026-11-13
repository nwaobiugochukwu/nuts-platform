import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class AdminCreateProductDto extends CreateProductDto {
  @ApiProperty()
  @IsUUID()
  vendorId!: string;
}
