import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { StoreViewDto } from '../tracking/dto/store-view.dto';
import { MarketplaceEventsService } from '../tracking/marketplace-events.service';

@ApiTags('MARKETPLACE ANALYTICS EVENTS')
@Controller('analytics/events/store-view')
export class MarketplaceEventsController {
  constructor(private readonly events: MarketplaceEventsService) {}

  @Post()
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Store view accepted')
  @ApiOperation({ summary: 'Record a storefront visit' })
  recordView(
    @GetUser('id') userId: string | undefined,
    @Body() event: StoreViewDto,
  ) {
    return this.events.recordStoreView(event.vendorId, event, userId);
  }
}
