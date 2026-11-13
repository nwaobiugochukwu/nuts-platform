import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { OrdersService } from '../orders.service';

import { CheckoutResponseDto } from '../dto/checkout-response.dto';
import { CheckoutDto } from '../dto/checkout.dto';
import { OrderResponseDto } from '../dto/order-response.dto';

import { PaginationQueryDto } from '@api/common/dto/pagination-query.dto';

import { ROLE } from '@prisma/client';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import type { RequestWithUser } from '@api/common/interfaces/request-with-user.interface';

@ApiTags('ORDERS')
@ApiBearerAuth()
@Controller('orders')
@Roles(ROLE.USER)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an order from the current cart',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Unique key for this checkout attempt. Reusing the same key safely returns the original order.',
    required: true,
  })
  @ApiQuery({
    name: 'addressId',
    required: false,
    description:
      'Saved shipping address UUID. Do not send this together with shippingAddress in the body.',
  })
  @ApiCreatedResponse({
    type: CheckoutResponseDto,
  })
  @Message('Order placed successfully')
  async checkout(
    @Req() req: RequestWithUser,
    @Headers('idempotency-key')
    idempotencyKey: string,
    @Query('addressId')
    addressId?: string,
    @Body()
    dto?: CheckoutDto,
  ): Promise<CheckoutResponseDto> {
    /**
     * Authentication has already been performed by JwtAuthGuard.
     */
    const userId = req.user.id;

    return this.ordersService.checkout(userId, dto!, addressId, idempotencyKey);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel my unpaid order',
  })
  @ApiParam({
    name: 'id',
    description: 'Order UUID',
  })
  @ApiOkResponse({
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @Message('Order cancelled successfully')
  async cancelMine(
    @Req() req: RequestWithUser,
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancelMine(req.user.id, orderId);
  }

  @Patch(':id/shipping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update shipping address on my order',
  })
  @ApiParam({
    name: 'id',
    description: 'Order UUID',
  })
  @ApiOkResponse({
    type: OrderResponseDto,
  })
  @Message('Shipping address updated successfully')
  async updateShipping(
    @Req() req: RequestWithUser,
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
    @Body('shippingAddress')
    shippingAddress: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateShippingMine(
      req.user.id,
      orderId,
      shippingAddress,
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Message('Orders retrieved successfully')
  @ApiOperation({
    summary: 'Get my orders',
  })
  @ApiOkResponse({
    description: 'Paginated list of the authenticated user orders.',
  })
  async findMine(
    @Req() req: RequestWithUser,
    @Query()
    query: PaginationQueryDto,
  ) {
    return this.ordersService.findMine(req.user.id, query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Message('Order retrieved successfully')
  @ApiOperation({
    summary: 'Get one of my orders',
  })
  @ApiParam({
    name: 'id',
    description: 'Order UUID',
  })
  @ApiOkResponse({
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  async findOne(
    @Req() req: RequestWithUser,
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOne(req.user.id, orderId);
  }
}
