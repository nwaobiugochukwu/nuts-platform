import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Master toggle for email notifications' })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Master toggle for in-app bell notifications',
  })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Master toggle for mobile / browser WebPush alerts',
  })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Toggle for order status changes (shipped, delivered, cancelled)',
  })
  @IsOptional()
  @IsBoolean()
  orderUpdates?: boolean;

  @ApiPropertyOptional({
    description: 'Toggle for financial and wallet updates (payments, payouts)',
  })
  @IsOptional()
  @IsBoolean()
  paymentAlerts?: boolean;

  @ApiPropertyOptional({
    description: 'Toggle for low inventory notifications (merchants)',
  })
  @IsOptional()
  @IsBoolean()
  inventoryAlerts?: boolean;

  @ApiPropertyOptional({
    description: 'Toggle for social activity such as new store followers',
  })
  @IsOptional()
  @IsBoolean()
  socialUpdates?: boolean;

  @ApiPropertyOptional({
    description: 'Toggle for marketing promotions, deals, and discounts',
  })
  @IsOptional()
  @IsBoolean()
  marketingPromos?: boolean;
}
