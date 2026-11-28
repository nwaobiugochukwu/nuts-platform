import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { AdminAnalyticsQueryDto } from '../dto/admin-analytics-query.dto';
import {
  ActivityAnalyticsDto,
  AdminAnalyticsSummaryDto,
  DiscountAnalyticsDto,
  FunnelAnalyticsDto,
  PaymentAnalyticsDto,
  ReferralAnalyticsDto,
  TopCategoryDto,
  TopProductDto,
  TopVendorDto,
  UserAnalyticsDto,
} from '../dto/admin-analytics-summary.dto';
import { ShopperEngagementSummaryDto } from '../dto/shopper-engagement.dto';

@Roles(ROLE.ADMIN)
@ApiTags('ADMIN - ANALYTICS')
@ApiBearerAuth('JWT-auth')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @Get('summary')
  @Message('Analytics summary retrieved')
  @ApiOperation({
    summary: 'Get admin analytics summary with trends',
    description: 'Retrieve a comprehensive analytics summary with trend data.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminAnalyticsSummaryDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getSummary(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto> {
    return this.analyticsService.getSummary(query);
  }

  @Get('top-products')
  @Message('Top products retrieved')
  @ApiOperation({
    summary: 'Top N products by revenue',
    description: 'Retrieve the top products ranked by revenue.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<TopProductDto[]> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getTopProducts(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<TopProductDto[] | undefined> {
    return this.analyticsService.getTopProducts(query);
  }

  @Get('top-vendors')
  @Message('Top vendors retrieved')
  @ApiOperation({
    summary: 'Top N vendors by revenue',
    description: 'Retrieve the top vendors ranked by revenue.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<TopVendorDto[]> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getTopVendors(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<TopVendorDto[] | undefined> {
    return this.analyticsService.getTopVendors(query);
  }

  @Get('top-categories')
  @Message('Top categories retrieved')
  @ApiOperation({
    summary: 'Top N categories by revenue',
    description: 'Retrieve the top categories ranked by revenue.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<TopCategoryDto[]> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getTopCategories(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<TopCategoryDto[] | undefined> {
    return this.analyticsService.getTopCategories(query);
  }

  @Get('payments')
  @Message('Payment analytics retrieved')
  @ApiOperation({
    summary: 'Payment analytics (success rate, methods)',
    description: 'Retrieve analytics for payment success rates and methods.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<PaymentAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getPaymentAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<PaymentAnalyticsDto | undefined> {
    return this.analyticsService.getPaymentAnalytics(query);
  }

  @Get('discounts')
  @Message('Discount analytics retrieved')
  @ApiOperation({
    summary: 'Discount code analytics',
    description:
      'Retrieve analytics for discount code usage and effectiveness.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<DiscountAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getDiscountAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<DiscountAnalyticsDto | undefined> {
    return this.analyticsService.getDiscountAnalytics(query);
  }

  @Get('referrals')
  @Message('Referral analytics retrieved')
  @ApiOperation({
    summary: 'Referral program analytics',
    description: 'Retrieve analytics for the referral program.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<ReferralAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getReferralAnalytics(): Promise<ReferralAnalyticsDto | undefined> {
    return this.analyticsService.getReferralAnalytics();
  }

  @Get('users')
  @Message('User analytics retrieved')
  @ApiOperation({
    summary: 'User analytics (cohorts, AOV, churn)',
    description:
      'Retrieve user analytics including cohorts, average order value, and churn.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<UserAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getUserAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<UserAnalyticsDto | undefined> {
    return this.analyticsService.getUserAnalytics(query);
  }

  @Get('funnel')
  @Message('Funnel analytics retrieved')
  @ApiOperation({
    summary: 'Cart → Checkout → Order conversion funnel',
    description:
      'Retrieve analytics for the cart-to-checkout-to-order conversion funnel.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<FunnelAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getFunnelAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<FunnelAnalyticsDto | undefined> {
    return this.analyticsService.getFunnelAnalytics(query);
  }

  @Get('activity')
  @Message('Activity analytics retrieved')
  @ApiOperation({
    summary: 'Admin activity audit log analytics',
    description: 'Retrieve analytics for admin activity audit logs.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<ActivityAnalyticsDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async getActivityAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<ActivityAnalyticsDto | undefined> {
    return this.analyticsService.getActivityAnalytics(query);
  }

  @Get('shopper-engagement')
  @Message('Shopper engagement retrieved')
  @ApiOperation({
    summary:
      'Storefront views, product engagement, cart conversion, and paid sales',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<ShopperEngagementSummaryDto>,
  })
  async getShopperEngagement(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<ShopperEngagementSummaryDto> {
    return this.analyticsService.getShopperEngagement(query);
  }
}
