import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminAuthUserDto } from './admin-auth-user.dto';

export class AdminAuthResponseDto {
  @ApiProperty({
    description: 'Authenticated admin user details',
    type: AdminAuthUserDto,
  })
  admin!: AdminAuthUserDto;

  @ApiPropertyOptional({
    description: 'JWT access token for Authorization header',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'OAuth 2.0 token type',
    example: 'Bearer',
  })
  tokenType?: string;

  @ApiPropertyOptional({
    description: 'Access token expiration lifetime in seconds',
    example: 900,
  })
  expiresIn?: number;
}
