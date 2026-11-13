import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VariantOptionDto {
  @ApiProperty({
    description: 'Option name, for example size or color.',
    example: 'size',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Option value, for example M or Black.',
    example: 'M',
  })
  @IsString()
  @IsNotEmpty()
  value!: string;
}
