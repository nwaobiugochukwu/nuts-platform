import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnouncementAudience,
  AnnouncementStatus,
  NotificationPriority,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const INTERNAL_LINK_PATTERN = /^\/(?!\/)[a-zA-Z0-9/_?&=.#%-]*$/;
const CAMPAIGN_AUDIENCES = ['CUSTOMERS', 'VENDORS'] as const;

export type CampaignAnnouncementAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export class CreateAdminAnnouncementDto {
  @ApiProperty({ maxLength: 120, example: 'Marketplace maintenance window' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @ApiProperty({ enum: CAMPAIGN_AUDIENCES })
  @IsIn(CAMPAIGN_AUDIENCES)
  audience!: CampaignAnnouncementAudience;

  @ApiPropertyOptional({ enum: NotificationPriority, default: 'MEDIUM' })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({ example: '/account/orders' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(INTERNAL_LINK_PATTERN, {
    message: 'link must be an internal path beginning with a single slash',
  })
  link?: string | null;
}

export class UpdateAdminAnnouncementDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ enum: CAMPAIGN_AUDIENCES })
  @IsOptional()
  @IsIn(CAMPAIGN_AUDIENCES)
  audience?: CampaignAnnouncementAudience;

  @ApiPropertyOptional({ enum: NotificationPriority })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({ example: '/account/orders' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(INTERNAL_LINK_PATTERN, {
    message: 'link must be an internal path beginning with a single slash',
  })
  link?: string | null;
}

export class ScheduleAdminAnnouncementDto {
  @ApiProperty({ example: '2026-11-12T09:00:00.000Z' })
  @IsDateString()
  scheduledAt!: string;
}

export class QueryAdminAnnouncementsDto {
  @ApiPropertyOptional({ enum: AnnouncementAudience })
  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  @ApiPropertyOptional({ enum: AnnouncementStatus })
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus;

  @ApiPropertyOptional({ example: 'maintenance' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
