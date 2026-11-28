import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { StoreViewDto } from '../dto/store-view.dto';
import { TrackingService } from '../services/tracking.service';

@ApiTags('STORE VIEW EVENTS')
@Controller('analytics/events/store-view')
export class StoreViewController {
  constructor(private readonly activity: TrackingService) {}

  @Post()
  @OptionalAuth()
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Store view accepted')
  @ApiOperation({ summary: 'Record a storefront visit' })
  recordView(
    @GetUser('id') userId: string | undefined,
    @GetUser('role') userRole: ROLE | undefined,
    @Body() event: StoreViewDto,
  ) {
    return this.activity.storeViewed(event.vendorId, event, userId, userRole);
  }
}
