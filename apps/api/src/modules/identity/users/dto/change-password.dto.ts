// DTO for changing user password

import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  NotEquals,
} from 'class-validator';
import { MaxPasswordBytes } from '@api/modules/shared/decorators/max-password-bytes.decorator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current user password',
    example: 'CurrentP@ssw0rd!',
  })
  @IsString()
  @IsNotEmpty({ message: 'Current password must not be empty' })
  @MaxPasswordBytes()
  currentPassword: string;

  @ApiProperty({
    description: 'New password for the user',
    example: 'NewP@ssw0rd!',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'New password must not be empty' })
  @MinLength(8, {
    message: 'New password must be at least 8 characters long',
  })
  @MaxPasswordBytes()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
    message:
      'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  @NotEquals('currentPassword', {
    message: 'New password must be different from current password',
  })
  newPassword: string;
}
