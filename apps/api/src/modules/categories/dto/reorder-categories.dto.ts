import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderCategoriesDto {
  @ApiProperty({
    description:
      'Ordered list of category IDs belonging to the same parent level.',
    type: [String],
    example: [
      'c1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'a9b8c7d6-e5f4-3210-fedc-ba9876543210',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  categoryIds!: string[];
}
