import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ToNumberDefault } from '@api/common/decorators/to-number.decorator';

/**
 * Shared cursor-based pagination input.
 *
 * Clients pass an opaque `cursor` (returned as `meta.nextCursor` from the
 * previous page) plus a `limit`. The first page omits `cursor`.
 * Filters themselves live in the request BODY (POST endpoints), not the
 * query string.
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({
    example: 10,
    default: 10,
    description: 'Maximum number of items to return (1-100)',
  })
  @ToNumberDefault(10)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 10;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from the previous response (meta.nextCursor). Omit for the first page.',
    example: 'eyJpZCI6Ii4uLiIsImNyZWF0ZWRBdCI6Ii4uLiJ9',
  })
  @IsString()
  @IsOptional()
  cursor?: string;
}
