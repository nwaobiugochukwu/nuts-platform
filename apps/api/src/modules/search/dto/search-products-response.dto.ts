import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '@api/common/dto/api-response.dto';
import { SearchProductHitDto } from './search-product-hit.dto';

export class SearchProductsResponseDto {
  @ApiProperty({
    description: 'List of search results matching the query',
    type: [SearchProductHitDto],
  })
  results!: SearchProductHitDto[];

  @ApiProperty({
    description: 'Pagination metadata for the search results',
    type: PaginationMetaDto,
  })
  pagination!: PaginationMetaDto;
}
