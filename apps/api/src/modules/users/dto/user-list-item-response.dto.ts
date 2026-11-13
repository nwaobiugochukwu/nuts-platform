import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserListItemResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the user',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'jane@example.com',
  })
  email!: string;

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
    description: 'Timestamp when the user deactivated their account',
    example: '2026-06-01T12:00:00.000Z',
    nullable: true,
  })
  deactivatedAt!: Date | null;

  @ApiPropertyOptional({
    description:
      'Scheduled date for permanent account deletion if not reactivated',
    example: '2026-08-01T12:00:00.000Z',
    nullable: true,
  })
  scheduledPermanentDeleteAt!: Date | null;

  @ApiPropertyOptional({
    description: 'Identifier of the administrator who suspended the account',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
  })
  deactivatedBy!: string | null;

  @ApiPropertyOptional({
    description:
      'Reason and duration metadata for account deactivation or suspension',
    example: '[SUSPENSION|until:2026-10-21T18:00:00.000Z] Terms violation',
    nullable: true,
  })
  deactivationReason!: string | null;

  @ApiProperty({
    description: 'Timestamp when the user record was created',
    example: '2025-01-15T08:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the user record was last updated',
    example: '2026-06-14T10:00:00.000Z',
  })
  updatedAt!: Date;
}
