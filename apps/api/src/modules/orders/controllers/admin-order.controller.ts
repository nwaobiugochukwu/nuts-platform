import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { AdminOrderResponseDto } from '@api/modules/orders/dto/admin-order-response.dto';
import { QueryOrderDto } from '@api/modules/orders/dto/query-order.dto';
import { UpdateOrderStatusDto } from '@api/modules/orders/dto/update-order-status.dto';
import { OrdersService } from '@api/modules/orders/orders.service';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@Roles(ROLE.ADMIN)
@ApiBearerAuth('JWT-auth')
@ApiTags('ADMIN - ORDERS')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Message('Orders retrieved successfully')
  @ApiOperation({
    summary: 'List all orders (admin, paginated)',
    description:
      'Filter by status, userId, date range, or search order number / customer email.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminOrderResponseDto[]> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  findAll(@Query() query: QueryOrderDto) {
    return this.ordersService.findAllAdmin(query);
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @Message('Orders retrieved successfully')
  @ApiOperation({
    summary: 'List orders (filters in body)',
    description: 'Same as GET /admin/orders but with filters in the JSON body.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminOrderResponseDto[]> })
  query(@Body() body: QueryOrderDto) {
    return this.ordersService.findAllAdmin(body);
  }

  @Get(':id')
  @Message('Order retrieved successfully')
  @ApiOperation({
    summary: 'Get order by ID with status history (admin)',
    description:
      'Retrieve a single order by its unique ID, including status history.',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminOrderResponseDto> })
  @ApiNotFoundResponse({ description: 'Order not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminOrderResponseDto> {
    return this.ordersService.findOneAdmin(id);
  }

  @Patch(':id/status')
  @Message('Order status updated successfully')
  @ApiOperation({
    summary: 'Update order status',
    description:
      'PENDINGâ†’PROCESSING|CANCELLED, PROCESSINGâ†’SHIPPED|CANCELLED, SHIPPEDâ†’DELIVERED. Cancelling restores stock once. Concurrent updates return 409.',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiBody({ type: UpdateOrderStatusDto })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminOrderResponseDto> })
  @ApiNotFoundResponse({ description: 'Order not found.' })
  @ApiConflictResponse({
    description:
      'Concurrent status change â€” the order was modified by another request.',
  })
  updateStatus(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<AdminOrderResponseDto> {
    return this.ordersService.updateStatusAdmin(
      id,
      dto.status,
      adminId,
      dto.note,
    );
  }
}
