import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUrl } from 'class-validator';

export class UnsubscribePushDto {
  @ApiProperty({ description: 'Push service endpoint URL to unsubscribe' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  endpoint!: string;
}
