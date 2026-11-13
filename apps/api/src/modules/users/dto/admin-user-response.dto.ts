import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminUserResponseDto {
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

  @ApiProperty({
    description: 'Indicates whether the account is currently active',
    example: true,
  })
  isActive!: boolean;

  @ApiPropertyOptional({
    description: 'Timestamp when the user deactivated their account',
    example: '2026-06-01T12:00:00.000Z',
    nullable: true,
  })
  deactivatedAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Identifier of the administrator who deactivated this account',
    example: 'admin-uuid-here',
    nullable: true,
  })
  deactivatedBy!: string | null;

  @ApiPropertyOptional({
    description: 'Reason provided for account deactivation',
    example: 'Violation of terms of service',
    nullable: true,
  })
  deactivationReason!: string | null;

  @ApiPropertyOptional({
    description:
      'Scheduled date for permanent account deletion if not reactivated',
    example: '2026-08-01T12:00:00.000Z',
    nullable: true,
  })
  scheduledPermanentDeleteAt!: Date | null;

  @ApiProperty({
    description: 'Timestamp when the user record was last updated',
    example: '2026-06-14T10:00:00.000Z',
  })
  updatedAt!: Date;
}
