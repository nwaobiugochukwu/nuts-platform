import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { MaxPasswordBytes } from '@api/modules/shared/decorators/max-password-bytes.decorator';
import { NormalizeEmail } from '@api/modules/shared/decorators/normalize-email.decorator';
import { Trim } from '@api/modules/shared/decorators/string-trim.decorator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
  })
  @NormalizeEmail()
  @IsEmail(
    {},
    {
      message: 'Please provide a valid email address',
    },
  )
  email!: string;

  @ApiProperty({
    example: '123456',
  })
  @Trim()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'OTP code must be 6 digits',
  })
  otpCode!: string;

  @ApiProperty({
    example: 'NewStrongPassword123!',
  })
  @IsString()
  @MinLength(8, {
    message: 'Password must be at least 8 characters',
  })
  @MaxLength(128)
  @MaxPasswordBytes()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#]).*$/, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  newPassword!: string;
}
