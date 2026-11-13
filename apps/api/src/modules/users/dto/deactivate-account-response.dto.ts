import { ApiProperty } from '@nestjs/swagger';

export class DeactivateAccountResponseDto {
  @ApiProperty({
    description:
      'Human-readable message confirming the deactivation and explaining next steps',
    example:
      'Account deactivated. It will be permanently deleted after 60 days unless you sign in again to reactivate.',
  })
  message!: string;

  @ApiProperty({
    description:
      'UTC date when the account will be permanently deleted if not reactivated',
    example: '2026-07-19T12:00:00.000Z',
  })
  scheduledPermanentDeleteAt!: Date;
}
