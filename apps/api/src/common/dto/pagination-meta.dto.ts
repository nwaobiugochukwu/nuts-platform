import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Maximum number of records per page',
    example: 20,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of items matching the query',
    example: 100,
  })
  totalItems!: number;

  @ApiProperty({
    description: 'Total number of pages available',
    example: 5,
  })
  totalPages!: number;

  @ApiProperty({ description: 'Whether there is a next page', example: true })
  hasNextPage!: boolean;

  @ApiProperty({
    description: 'Whether there is a previous page',
    example: false,
  })
  hasPreviousPage!: boolean;

  /**
   * Factory method to create pagination metadata from count and page parameters
   */
  static create(total: number, page: number, limit: number): PaginationMetaDto {
    const totalPages = Math.ceil(total / limit);
    const dto = new PaginationMetaDto();
    dto.page = page;
    dto.limit = limit;
    dto.totalItems = total;
    dto.totalPages = totalPages;
    dto.hasNextPage = page < totalPages;
    dto.hasPreviousPage = page > 1;
    return dto;
  }
}
