import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserIdentitySummaryDto } from '@api/common/dto/user-identity-summary.dto';

export { UserIdentitySummaryDto as AuthUserDto };

export class AuthResponseDto {
  @ApiProperty({
    description: 'Authenticated user details',
    type: UserIdentitySummaryDto,
  })
  user!: UserIdentitySummaryDto;

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

export class AuthApiResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'User registered successfully' })
  message!: string;

  @ApiProperty({ type: AuthResponseDto })
  data!: AuthResponseDto;

  @ApiProperty({ example: '2026-09-18T22:00:00.000Z' })
  timestamp!: string;
}

export class RegisterResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the newly created user',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  userId!: string;

  @ApiProperty({
    description: 'Email address of the registered user',
    example: 'jane@example.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Whether email verification is required',
    example: true,
  })
  requiresVerification!: boolean;
}

export class VerifyOtpResponseDto {
  @ApiProperty({
    description: 'Whether OTP verification succeeded',
    example: true,
  })
  verified!: boolean;
}

export class UserCapabilitiesDto {
  @ApiPropertyOptional({
    description:
      'Whether the identity can place orders and create shopping carts',
    example: true,
  })
  canPurchase?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether the identity can manage a vendor catalog and receive orders',
    example: true,
  })
  canSell?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether the identity has administrative management privileges',
    example: true,
  })
  canAdminister?: boolean;
}

export class AuthProfileResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string | null;

  @ApiProperty({ example: 'Doe' })
  lastName!: string | null;

  @ApiProperty({ enum: ['USER', 'VENDOR', 'ADMIN'], example: 'USER' })
  role!: string;

  @ApiProperty({ type: UserCapabilitiesDto })
  capabilities!: UserCapabilitiesDto;
}
