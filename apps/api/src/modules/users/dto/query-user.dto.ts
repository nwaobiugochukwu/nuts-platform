import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ToBoolean } from '@api/common/decorators/to-boolean.decorator';

/**
 * Account lifecycle status:
 * - ACTIVE     â€” isActive = true
 * - INACTIVE   â€” isActive = false, self-deactivated (no admin ban)
 * - BANNED     â€” isActive = false, deactivated by an admin
 */
export const USER_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'BANNED',
  'SUSPENDED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export class QueryUserDto {
  @ApiPropertyOptional({ description: 'Search by email, first or last name' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Filter by account status. BANNED = deactivated by an admin, INACTIVE = self-deactivated.',
    enum: USER_STATUSES,
  })
  @IsIn(USER_STATUSES)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @ToBoolean()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from the previous response (meta.nextCursor). Omit for the first page.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;
}
