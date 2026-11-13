import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserProfileDto {
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
  phone!: string | null;

  @ApiProperty({
    description: 'Indicates whether the account email is verified',
    example: true,
  })
  isEmailVerified!: boolean;

  @ApiPropertyOptional({
    description:
      'Indicates whether the user email address is verified (legacy alias)',
    example: true,
  })
  isVerified?: boolean;

  @ApiProperty({
    description: 'Indicates whether the account is currently active',
    example: true,
  })
  isActive!: boolean;

  @ApiPropertyOptional({
    description: 'Unique referral code assigned to the user',
    example: 'REF-A1B2C3',
    nullable: true,
  })
  referralCode!: string | null;

  @ApiPropertyOptional({
    description: 'Default shipping address captured during sign-up',
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
}
