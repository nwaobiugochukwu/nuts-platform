import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from './pagination-meta.dto';

export { PaginationMetaDto } from './pagination-meta.dto';

/**
 * Error detail structure.
 */
export class ErrorDetailDto {
  @ApiProperty({
    description: 'Machine-readable error code',
    example: 'VALIDATION_ERROR',
  })
  code!: string;

  @ApiPropertyOptional({
    description: 'Detailed error messages or field-level errors',
    example: ['email must be a valid email address'],
  })
  details?: string[];
}

/**
 * Standard success response wrapper for all API endpoints.
 */
export class ApiResponseDto<TData = unknown> {
  @ApiProperty({
    description: 'Indicates the request was successful',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Human-readable message describing the result',
    example: 'Request successful',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'The response payload',
  })
  data?: TData | null;

  @ApiPropertyOptional({
    description:
      'Pagination metadata when the response contains a page of data',
    type: () => PaginationMetaDto,
  })
  meta?: PaginationMetaDto;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the response',
    example: '2026-09-18T22:00:00.000Z',
  })
  timestamp!: string;
}

/**
 * Standard paginated response wrapper for list endpoints.
 */
export class PaginatedApiResponseDto<TData = unknown> extends ApiResponseDto<
  TData[]
> {
  @ApiProperty({
    description: 'Pagination metadata for list endpoints',
    type: () => PaginationMetaDto,
  })
  declare meta?: PaginationMetaDto;
}

/**
 * Standard error response structure.
 */
export class ApiErrorResponseDto {
  @ApiProperty({ description: 'Indicates the request failed', example: false })
  success!: boolean;

  @ApiProperty({ description: 'Error message', example: 'Validation failed' })
  message!: string;

  @ApiPropertyOptional({
    description: 'Detailed error information',
    type: () => ErrorDetailDto,
  })
  error?: ErrorDetailDto;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the error',
    example: '2025-06-14T10:30:00.000Z',
  })
  timestamp!: string;
}

export function buildSuccessResponse<T>(
  data: T,
  message = 'Request successful',
  meta?: PaginationMetaDto,
): ApiResponseDto<T> {
  return {
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
    timestamp: new Date().toISOString(),
  };
}
