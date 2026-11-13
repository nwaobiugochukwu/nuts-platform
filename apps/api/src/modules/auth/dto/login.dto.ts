import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

import { MaxPasswordBytes } from '@api/common/decorators/max-password-bytes.decorator';
import { NormalizeEmail } from '@api/common/decorators/normalize-email.decorator';

export class LoginDto {
  @ApiProperty({
    example: 'jane@example.com',
  })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @ApiProperty({
    example: 'StrongPassword123!',
  })
  @IsString()
  @MaxPasswordBytes()
  @MinLength(8, {
    message: 'Password must be at least 8 characters',
  })
  password!: string;
}
