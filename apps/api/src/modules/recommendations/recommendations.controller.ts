import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { ApiEnvelopeResponse } from '@api/common/decorators/api-envelope-response.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { RecommendationsService } from './recommendations.service';
import { Public } from '@api/common/decorators/public.decorator';
import { ClaimRecentHistoryDto } from './dto/claim-recent-history.dto';
import { MarketplaceMixResponseDto } from './dto/marketplace-mix-response.dto';

@ApiTags('RECOMMENDATIONS')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('for-you')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Personalized recommendations retrieved successfully')
  @ApiOperation({
    summary: 'Get recommendations personalized for the current user',
  })
  forYou(
    @GetUser('id') userId: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.forYou(userId, sessionId, visitorId);
  }

  @Get('for-you/session')
  @Public()
  @Message('Session recommendations retrieved successfully')
  @ApiOperation({
    summary: 'Get recommendations based on this browser session',
  })
  forYouForSession(
    @Query('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.forYou(undefined, sessionId, visitorId);
  }

  @Get('search-discover')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Personalized search discovery retrieved successfully')
  @ApiOperation({
    summary:
      'Get personalized product and store recommendations for search discovery',
  })
  searchDiscover(
    @GetUser('id') userId: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.searchDiscover(userId, sessionId, visitorId);
  }

  @Get('search-discover/session')
  @Public()
  @Message('Personalized search discovery retrieved successfully')
  @ApiOperation({
    summary:
      'Get personalized product and store recommendations for this browser',
  })
  searchDiscoverForSession(
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.searchDiscover(undefined, sessionId, visitorId);
  }

  @Get('marketplace-mix')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Marketplace mix retrieved successfully')
  @ApiOperation({
    summary:
      'Get a daily rotating selection of purchasable products from distinct vendors',
    description:
      'Returns up to 12 active vendors, with one in-stock product with an image from each. Vendor selection balances category variety and freshness. Product selection rotates among each vendor’s eight most recent eligible listings and is stable per shopper identity for the UTC day.',
  })
  @ApiEnvelopeResponse(MarketplaceMixResponseDto, {
    description: 'Up to twelve distinct active vendors, each with one product.',
  })
  marketplaceMix(
    @GetUser('id') userId: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.marketplaceMix(userId, sessionId, visitorId);
  }

  @Get('marketplace-mix/session')
  @Public()
  @Message('Marketplace mix retrieved successfully')
  @ApiOperation({
    summary:
      'Get a daily rotating selection of purchasable products from distinct vendors',
    description:
      'Returns up to 12 active vendors, with one in-stock product with an image from each. Vendor selection balances category variety and freshness. Product selection rotates among each vendor’s eight most recent eligible listings and is stable per visitor identity for the UTC day.',
  })
  @ApiEnvelopeResponse(MarketplaceMixResponseDto, {
    description: 'Up to twelve distinct active vendors, each with one product.',
  })
  marketplaceMixForSession(
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.marketplaceMix(undefined, sessionId, visitorId);
  }

  @Get('recently-viewed')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Recently viewed products retrieved successfully')
  recentlyViewed(
    @GetUser('id') userId: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.recentlyViewed(userId, sessionId, visitorId);
  }

  @Post('recently-viewed/claim')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Guest recent history linked to your account')
  @ApiOperation({
    summary: 'Claim recent browsing from this anonymous browser identity',
  })
  claimRecentlyViewed(
    @GetUser('id') userId: string,
    @Body() body: ClaimRecentHistoryDto,
  ) {
    return this.recommendations.claimRecentlyViewed(userId, body.visitorId);
  }

  @Get('recently-viewed/session')
  @Public()
  @Message('Recently viewed products retrieved successfully')
  recentlyViewedForSession(
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.recentlyViewed(undefined, sessionId, visitorId);
  }

  @Get('following')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('New products from followed vendors retrieved successfully')
  following(@GetUser('id') userId: string) {
    return this.recommendations.following(userId);
  }

  @Get('stores')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('Stores recommended for the current customer retrieved successfully')
  discoverStores(
    @GetUser('id') userId: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.discoverStores(userId, sessionId, visitorId);
  }

  @Get('stores/session')
  @Public()
  @Message('Stores recommended for this browser retrieved successfully')
  discoverStoresForSession(
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.discoverStores(undefined, sessionId, visitorId);
  }

  @Get('discover')
  @Public()
  @Message('Recommended discovery products retrieved successfully')
  @ApiOperation({
    summary: 'Get recommended discovery products for the marketplace',
  })
  discover() {
    return this.recommendations.discover();
  }

  @Get('related/:productId')
  @Public()
  @Message('Related products retrieved successfully')
  @ApiOperation({ summary: 'Get products related by purchases and category' })
  related(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.recommendations.related(productId);
  }
}
