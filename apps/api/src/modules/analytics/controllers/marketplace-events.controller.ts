import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { StoreViewDto } from '../tracking/dto/store-view.dto';
import { MarketplaceEventsService } from '../tracking/marketplace-events.service';

@ApiTags('MARKETPLACE ANALYTICS EVENTS')
@Controller('analytics/events/store-view')
export class MarketplaceEventsController {
  constructor(private readonly events: MarketplaceEventsService) {}

  @Post('guest')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Store view accepted')
  @ApiOperation({ summary: 'Record an anonymous storefront visit' })
  recordGuestView(@Body() event: StoreViewDto) {
    return this.events.recordStoreView(event.vendorId, event);
  }

  @Post('authenticated')
  @Roles(ROLE.USER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('JWT-auth')
  @Message('Store view accepted')
  @ApiOperation({ summary: 'Record a customer storefront visit' })
  recordCustomerView(
    @GetUser('id') userId: string,
    @Body() event: StoreViewDto,
  ) {
    return this.events.recordStoreView(event.vendorId, event, userId);
  }
}
