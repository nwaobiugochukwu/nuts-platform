import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { VariantOptionDto } from '@api/common/dto/variant-option.dto';

export { VariantOptionDto as VariantOptionItemDto };

export class CreateVariantDto {
  @ApiProperty({
    description:
      'Variant options. Option names must be unique within the variant.',
    type: () => VariantOptionDto,
    isArray: true,
    example: [
      {
        name: 'size',
        value: 'M',
      },
      {
        name: 'color',
        value: 'Black',
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantOptionDto)
  options!: VariantOptionDto[];

  @ApiProperty({
    description: 'Initial stock quantity.',
    example: 5,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({
    description: 'Variant-specific image URLs.',
    type: String,
    isArray: true,
    example: ['https://cdn.example.com/variant-black-m.jpg'],
  })
  @IsOptional()
  @IsString({ each: true })
  images?: string[];
}
