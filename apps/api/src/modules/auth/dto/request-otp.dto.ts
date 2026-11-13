import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

import { NormalizeEmail } from '@api/common/decorators/normalize-email.decorator';

export class RequestOtpDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to send the OTP to',
  })
  @NormalizeEmail()
  @IsEmail(
    {},
    {
      message: 'Please provide a valid email address',
    },
  )
  @IsNotEmpty()
  email!: string;
}
