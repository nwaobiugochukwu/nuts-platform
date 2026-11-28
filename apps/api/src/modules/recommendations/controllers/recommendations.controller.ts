import {
  Body,
  Controller,
  Get,
  Header,
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
import { RecommendationsService } from '../services/recommendations.service';
import { Public } from '@api/common/decorators/public.decorator';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { ClaimRecentHistoryDto } from '../dto/claim-recent-history.dto';
import { NotInterestedDto } from '../dto/not-interested.dto';
import { GoodPlaceToStartResponseDto } from '../dto/good-place-to-start-response.dto';

@ApiTags('RECOMMENDATIONS')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('for-you')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message('Personalized recommendations retrieved successfully')
  @ApiOperation({
    summary:
      'Get recommendations personalized for the current user or browser session',
  })
  forYou(
    @GetUser('id') userId?: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.forYou(userId, sessionId, visitorId);
  }

  @Get('search-discover')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message('Personalized search discovery retrieved successfully')
  @ApiOperation({
    summary:
      'Get personalized product and store recommendations for search discovery',
  })
  searchDiscover(
    @GetUser('id') userId?: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.searchDiscover(userId, sessionId, visitorId);
  }

  @Get('good-place-to-start')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message('Good place to start retrieved successfully')
  @ApiOperation({
    summary:
      'Get the home page’s first shelf: a daily spread across stores, topped up with picks for the shopper',
    description:
      'Returns up to 12 purchasable products with an image, at most one per store. It starts with a spread across stores that is stable per shopper identity for the UTC day, then adds products picked from what the shopper has done. A new visitor gets the spread alone. Each item says where it came from.',
  })
  @ApiEnvelopeResponse(GoodPlaceToStartResponseDto, {
    description: 'Up to twelve products, each from a different store.',
  })
  goodPlaceToStart(
    @GetUser('id') userId?: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.goodPlaceToStart(userId, sessionId, visitorId);
  }

  @Get('recently-viewed')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message('Recently viewed products retrieved successfully')
  recentlyViewed(
    @GetUser('id') userId?: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.recentlyViewed(userId, sessionId, visitorId);
  }

  @Post('not-interested')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message('Got it. We will show you less like this')
  @ApiOperation({
    summary: 'Hide a product from the personalised shelf ("Not interested")',
  })
  notInterested(
    @Body() body: NotInterestedDto,
    @GetUser('id') userId?: string,
  ) {
    return this.recommendations.dismissProduct({
      productId: body.productId,
      userId,
      sessionId: body.sessionId,
      visitorId: body.visitorId,
    });
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

  @Get('following')
  @Header('Cache-Control', 'private, no-store')
  @ApiBearerAuth('JWT-auth')
  @Roles(ROLE.USER)
  @Message('New products from followed vendors retrieved successfully')
  following(@GetUser('id') userId: string) {
    return this.recommendations.following(userId);
  }

  @Get('stores')
  @Header('Cache-Control', 'private, no-store')
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @Message(
    'Stores recommended for the customer or browser session retrieved successfully',
  )
  discoverStores(
    @GetUser('id') userId?: string,
    @Query('sessionId', new ParseUUIDPipe({ optional: true }))
    sessionId?: string,
    @Query('visitorId', new ParseUUIDPipe({ optional: true }))
    visitorId?: string,
  ) {
    return this.recommendations.discoverStores(userId, sessionId, visitorId);
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

  @Get(':productId/related')
  @Public()
  @Message('Related products retrieved successfully')
  @ApiOperation({ summary: 'Get products related by purchases and category' })
  related(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.recommendations.related(productId);
  }
}
