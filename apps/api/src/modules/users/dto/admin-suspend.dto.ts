import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdminSuspendDto {
  @ApiProperty({
    description: 'Administrative reason for account suspension',
    example: 'Terms of service violation: suspicious chargebacks',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    description:
      'Suspension duration preset (e.g. "24h", "3d", "7d", "14d", "30d", "indefinite") or custom',
    example: '7d',
  })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp until which account remains suspended (null or empty for indefinite)',
    example: '2026-10-21T18:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  suspendedUntil?: string;
}

// Alias for backward compatibility
export { AdminSuspendDto as AdminDeactivateDto };
