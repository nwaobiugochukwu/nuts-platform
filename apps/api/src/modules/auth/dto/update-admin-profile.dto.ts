import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAdminProfileDto {
  @ApiPropertyOptional({ description: 'Admin first name', example: 'Temitayo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ description: 'Admin last name', example: 'Ugochukwu' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}
