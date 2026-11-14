import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { VendorFollowsService } from '../vendor-follows.service';

@ApiTags('VENDOR FOLLOWS')
@ApiBearerAuth('JWT-auth')
@Controller(['vendors/follows', 'vendors'])
@Roles(ROLE.USER)
export class VendorFollowsController {
  constructor(private readonly follows: VendorFollowsService) {}

  @Get()
  @Message('Followed vendors retrieved successfully')
  @ApiOperation({ summary: 'List vendors followed by the current customer' })
  list(@GetUser('id') userId: string) {
    return this.follows.list(userId);
  }

  @Get('manage')
  @Message('Followed vendors retrieved successfully')
  @ApiOperation({ summary: 'Search and page through followed stores' })
  manage(
    @GetUser('id') userId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.follows.manage(userId, search, page, limit);
  }

  @Get('count')
  @Message('Followed vendor count retrieved successfully')
  count(@GetUser('id') userId: string) {
    return this.follows.count(userId);
  }

  @Post([':vendorId', ':vendorId/follow'])
  @Message('Vendor followed successfully')
  @ApiOperation({ summary: 'Follow an active public vendor store' })
  async follow(
    @GetUser('id') userId: string,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ) {
    return this.follows.follow(userId, vendorId);
  }

  @Delete([':vendorId', ':vendorId/follow'])
  @Message('Vendor unfollowed successfully')
  @ApiOperation({ summary: 'Unfollow a vendor store' })
  async unfollow(
    @GetUser('id') userId: string,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ) {
    return this.follows.unfollow(userId, vendorId);
  }
}
