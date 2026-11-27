import { IsOptional, IsString, IsUUID } from 'class-validator';

export class TrackProductViewDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class TrackProductViewInternalDto {
  productId: string;
  userId?: string;
  sessionId?: string;
}
