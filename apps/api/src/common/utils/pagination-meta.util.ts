import { PaginationMetaDto } from '@api/common/dto/pagination-meta.dto';

/**
 * Build pagination metadata from raw query results.
 * This is the single source of truth for pagination meta across the app.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMetaDto {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * @deprecated Use `buildPaginationMeta` instead. Kept for backward compatibility.
 */
export const createPaginationMeta = buildPaginationMeta;
