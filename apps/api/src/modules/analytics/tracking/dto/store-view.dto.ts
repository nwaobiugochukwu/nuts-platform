import { IsOptional, IsUUID } from 'class-validator';

export class StoreViewDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  vendorId!: string;

  @IsOptional()
  @IsUUID()
  visitorId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
