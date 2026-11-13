import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePlatformConfigDto {
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @ApiPropertyOptional({
    example: 'Scheduled maintenance tonight from 2AM to 3AM UTC',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  maintenanceMessage?: string | null;

  /** @deprecated Use maintenanceMessage. Kept while older admin clients roll forward. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  announcement?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowRegistrations?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowVendorRegistrations?: boolean;
}

export class PlatformConfigResponseDto {
  @ApiProperty()
  maintenanceMode!: boolean;

  @ApiPropertyOptional()
  maintenanceMessage!: string | null;

  @ApiPropertyOptional({ deprecated: true })
  announcement?: string | null;

  @ApiProperty()
  allowRegistrations!: boolean;

  @ApiProperty()
  allowVendorRegistrations!: boolean;

  @ApiProperty()
  updatedAt!: Date;
}
