import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuspendUserResponseDto {
  @ApiProperty({
    description: 'Human-readable message confirming account suspension',
    example:
      'Account suspended until Wed, 21 Oct 2026 18:00:00 GMT. Reason: Terms of service violation',
  })
  message!: string;

  @ApiPropertyOptional({
    description:
      'UTC date until which the account is suspended, or null if indefinite',
    example: '2026-10-21T18:00:00.000Z',
    nullable: true,
  })
  suspendedUntil!: Date | null;

  @ApiProperty({
    description:
      'Indicates if the suspension is indefinite/permanent until manually unsuspended',
    example: false,
  })
  isIndefinite!: boolean;

  @ApiProperty({
    description: 'The administrative justification reason recorded',
    example: 'Terms of service violation: suspicious chargebacks',
  })
  reason!: string;
}
