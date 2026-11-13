import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the user',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiPropertyOptional({
    description: 'First name of the user',
    example: 'Jane',
    nullable: true,
  })
  firstName!: string | null;

  @ApiPropertyOptional({
    description: 'Last name of the user',
    example: 'Doe',
    nullable: true,
  })
  lastName!: string | null;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'jane@example.com',
  })
  email!: string;

  @ApiPropertyOptional({
    description: 'Primary phone number for the user',
    example: '+1-555-123-4567',
    nullable: true,
  })
  phoneNumber!: string | null;

  @ApiProperty({
    description: 'Indicates whether the user email address is verified',
    example: true,
  })
  isEmailVerified!: boolean;

  @ApiProperty({
    description:
      'Indicates whether the user email address is verified (legacy alias)',
    example: true,
  })
  isVerified!: boolean;

  @ApiProperty({
    description: 'Timestamp when the user record was created',
    example: '2025-01-15T08:30:00.000Z',
  })
  createdAt!: Date;

  @ApiPropertyOptional({
    description: 'Default shipping address for the user',
    nullable: true,
  })
  shippingInformation?: {
    id: string;
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    country: string;
    isDefault: boolean;
  } | null;

  @ApiPropertyOptional({
    description: 'Unique referral code assigned to the user',
    example: 'NUTS-AB12CD',
    nullable: true,
  })
  referralCode?: string | null;

  /**
   * Sensitive fields deliberately excluded:
   * - password / hashedPassword
   * - refreshToken / refreshTokenId
   * - otp / otpCode
   * - resetPasswordToken
   * - verificationToken
   * - isActive, deactivatedAt, deactivatedBy, deactivationReason
   * - scheduledPermanentDeleteAt, updatedAt
   */
}
