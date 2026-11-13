import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MoveCategoryDto {
  @ApiPropertyOptional({
    description:
      'UUID of the new parent category, or null to move to the root level.',
    example: 'd2c3b4a5-e6f7-8901-bcde-fa2345678901',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  newParentId!: string | null;
}
