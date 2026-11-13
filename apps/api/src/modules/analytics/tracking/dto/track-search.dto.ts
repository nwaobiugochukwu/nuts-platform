import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class TrackSearchDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsNumber()
  @Min(0)
  resultsCount!: number;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class TrackSearchInternalDto {
  query: string;
  resultsCount: number;
  userId?: string;
  sessionId?: string;
}
