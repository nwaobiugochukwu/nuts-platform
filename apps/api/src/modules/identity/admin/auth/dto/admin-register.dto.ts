import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MaxPasswordBytes } from '@api/modules/shared/decorators/max-password-bytes.decorator';

export class AdminRegisterDto {
  @ApiProperty({ description: 'Admin email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Admin password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @MaxPasswordBytes()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/)
  password!: string;

  @ApiProperty({ description: 'Admin first name', required: false })
  @IsOptional()
  firstName?: string;

  @ApiProperty({ description: 'Admin last name', required: false })
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Initial admin setup secret' })
  @IsOptional()
  @IsString()
  setupSecret?: string;

  @ApiPropertyOptional({ description: 'Setup secret alias', required: false })
  @IsOptional()
  @IsString()
  secret?: string;
}
