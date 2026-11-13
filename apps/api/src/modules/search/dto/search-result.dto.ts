import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '@api/common/dto/api-response.dto';

export class SearchResultDto {
  @ApiProperty({ description: 'Document id' })
  id!: string;

  @ApiProperty({ description: 'Elasticsearch index name' })
  index!: string;

  @ApiProperty({ description: 'Result type label' })
  type!: string;

  @ApiProperty({ description: 'Primary title of the result' })
  title!: string;

  @ApiPropertyOptional({ description: 'Secondary text or summary' })
  subtitle?: string;

  @ApiProperty({ description: 'Relevance score from Elasticsearch' })
  score!: number;

  @ApiPropertyOptional({
    description: 'Payload metadata for deep navigation and rich display',
  })
  payload?: Record<string, unknown>;
}

export class SearchResponseDto {
  @ApiProperty({ type: [SearchResultDto] })
  results!: SearchResultDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
