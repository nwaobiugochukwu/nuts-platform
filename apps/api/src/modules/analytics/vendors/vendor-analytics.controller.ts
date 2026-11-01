import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/modules/shared/decorators/role.decorator';
import { GetVendor } from '@api/modules/shared/decorators/get-vendor.decorator';
import { Message } from '@api/modules/shared/decorators/message.decorator';
import { ApiResponseDto } from '@api/modules/shared/dto/api-response.dto';
import { VendorAnalyticsQueryDto } from './dto/vendor-analytics-query.dto';
import { VendorAnalyticsSummaryDto } from './dto/vendor-analytics-summary.dto';
import { VendorAnalyticsService } from './vendor-analytics.service';

@ApiTags('VENDOR - ANALYTICS')
@Controller('vendors/analytics')
@Roles(ROLE.VENDOR)
export class VendorAnalyticsController {
  constructor(private readonly analyticsService: VendorAnalyticsService) {}

  @Get()
  @ApiBearerAuth('JWT-auth')
  @Message('Vendor analytics retrieved')
  @ApiOperation({
    summary: 'Get vendor store analytics with trends',
    description:
      "Retrieve aggregated analytics for the authenticated vendor's store, including order stats, revenue, and trend data",
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorAnalyticsSummaryDto>,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid query parameters',
  })
  async getAnalytics(
    @GetVendor('id') vendorId: string,
    @Query() query: VendorAnalyticsQueryDto,
  ): Promise<VendorAnalyticsSummaryDto> {
    return this.analyticsService.getAnalytics(vendorId, query);
  }

  /**
   * Body-based variant — filters (range/startDate/endDate/top) travel in the
   * request body instead of the query string so they don't appear in URLs.
   */
  @Post()
  @HttpCode(200)
  @ApiBearerAuth('JWT-auth')
  @Message('Vendor analytics retrieved')
  @ApiOperation({
    summary: 'Get vendor store analytics (filters in body)',
    description:
      'Same payload as GET /vendors/analytics but with the filters in the JSON body.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorAnalyticsSummaryDto>,
  })
  async getAnalyticsFromBody(
    @GetVendor('id') vendorId: string,
    @Body() body: VendorAnalyticsQueryDto,
  ): Promise<VendorAnalyticsSummaryDto> {
    return this.analyticsService.getAnalytics(vendorId, body);
  }
}
