// vendor-orders.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UpdateOrderStatusDto } from '@api/modules/orders/dto/update-order-status.dto';
import { VendorOrderResponseDto } from '@api/modules/orders/dto/vendor-order-response.dto';
import { OrdersService } from '@api/modules/orders/orders.service';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/modules/shared/decorators/role.decorator';
import { GetVendor } from '@api/modules/shared/decorators/get-vendor.decorator';
import { Message } from '@api/modules/shared/decorators/message.decorator';
import { ApiResponseDto } from '@api/modules/shared/dto/api-response.dto';

@ApiTags('VENDOR - ORDERS')
@Controller('vendors/orders')
@Roles(ROLE.VENDOR)
@ApiBearerAuth('JWT-auth')
export class VendorOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Message('Orders retrieved successfully')
  @ApiOperation({
    summary: 'List orders containing your products (vendor)',
    description:
      'Paginated list of orders that include your products. Filter by status and date range.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 10,
    description: 'Items per page',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by order status',
  })
  @ApiQuery({
    name: 'fromDate',
    required: false,
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({
    name: 'toDate',
    required: false,
    description: 'End date (ISO 8601)',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorOrderResponseDto[]>,
    description: 'Paginated list of orders containing your products',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async findAll(
    @GetVendor('id') vendorId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    // Keep pagination/filter parsing in the service so the controller
    // remains an HTTP adapter rather than a business-logic layer.
    return this.ordersService.findAllForVendor(vendorId, {
      page,
      limit,
      status,
      search,
      fromDate,
      toDate,
    });
  }

  @Get(':id')
  @Message('Order retrieved successfully')
  @ApiOperation({
    summary: 'Get order details (vendor)',
    description: 'View details of an order containing your products.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order ID',
  })
  @ApiOkResponse({
    type: VendorOrderResponseDto,
    description: 'Order details with your product line items',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  async findOne(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.findOneForVendor(vendorId, id);
  }

  @Patch(':id/status')
  @Message('Order status updated successfully')
  @ApiOperation({
    summary: 'Update order status for a fulfillment action',
    description:
      'Advance the fulfillment status of an order that contains your products.\n\n' +
      '**Allowed transitions:**\n' +
      '- `PROCESSING` → `SHIPPED` — when you have shipped the items\n' +
      '- `SHIPPED` → `DELIVERED` — when the customer has received the items\n\n' +
      'Use the `note` field to record a reason, tracking number, or any other context.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order ID',
  })
  @ApiBody({
    type: UpdateOrderStatusDto,
  })
  @ApiOkResponse({
    type: VendorOrderResponseDto,
    description: 'Order status updated successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid transition or you do not own any items in this order',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @ApiConflictResponse({
    description: 'Order was modified by another request; retry',
  })
  async updateStatus(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<VendorOrderResponseDto> {
    return this.ordersService.updateStatusForVendor(
      vendorId,
      id,
      dto.status,
      dto.note,
    );
  }
}
