import { IsUUID } from 'class-validator';

export class ClaimRecentHistoryDto {
  @IsUUID()
  visitorId!: string;
}
