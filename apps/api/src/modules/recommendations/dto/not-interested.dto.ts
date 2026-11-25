import { IsOptional, IsUUID } from 'class-validator';

export class NotInterestedDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  visitorId?: string;
}
