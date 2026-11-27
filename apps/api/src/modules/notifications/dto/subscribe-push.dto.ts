import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'Client public P256DH key' })
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @ApiProperty({ description: 'Client authentication secret' })
  @IsString()
  @IsNotEmpty()
  auth!: string;
}

export class SubscribePushDto {
  @ApiProperty({ description: 'Browser push service endpoint URL' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({
    description: 'Cryptographic keys for payload encryption',
    type: PushSubscriptionKeysDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;

  @ApiPropertyOptional({ description: 'Browser or device user-agent string' })
  @IsOptional()
  @IsString()
  userAgent?: string;
}
