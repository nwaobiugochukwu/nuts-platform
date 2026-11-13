import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserIdentitySummaryDto {
  @ApiProperty({ description: 'Unique identifier of the user' })
  id!: string;

  @ApiProperty({ description: 'User email address' })
  email!: string;

  @ApiPropertyOptional({ description: 'User first name', nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ description: 'User last name', nullable: true })
  lastName?: string | null;
}
