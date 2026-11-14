import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '@api/common/decorators/public.decorator';
import { PaymentsService } from '../payments.service';

import { RefundPaymentDto } from '../dto';

import {
  InitializePaymentResponseDto,
  PaymentResponseDto,
} from '../dto/payment-response.dto';

import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';

@ApiTags('PAYMENTS')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ---------------------------------------------------------------------------
  // INITIALIZE
  // ---------------------------------------------------------------------------

  @Post('initialize')
  @HttpCode(HttpStatus.OK)
  @Message('Payment initialized successfully')
  @Roles(ROLE.USER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initialize Paystack payment for an order',
  })
  @ApiQuery({
    name: 'orderId',
    required: true,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: InitializePaymentResponseDto,
  })
  async initialize(
    @GetUser('id') userId: string,
    @Query(
      'orderId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
  ): Promise<InitializePaymentResponseDto> {
    return this.paymentsService.initializeForOrder(userId, orderId);
  }

  // ---------------------------------------------------------------------------
  // FIND PAYMENT
  // ---------------------------------------------------------------------------

  @Get('order/:orderId')
  @HttpCode(HttpStatus.OK)
  @Message('Order payment details retrieved successfully')
  @Roles(ROLE.USER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get payment for an order',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order UUID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PaymentResponseDto,
  })
  async findByOrder(
    @GetUser('id') userId: string,
    @Param(
      'orderId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.findByOrder(userId, orderId);
  }

  // ---------------------------------------------------------------------------
  // PAYSTACK CALLBACK & VERIFICATION
  // ---------------------------------------------------------------------------

  @Public()
  @Get('callback')
  @HttpCode(HttpStatus.OK)
  @Message('Payment verified successfully')
  @ApiOperation({
    summary: 'Paystack payment callback and verification',
  })
  @ApiQuery({
    name: 'reference',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'trxref',
    required: false,
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PaymentResponseDto,
  })
  async verifyCallback(
    @Query('reference')
    reference?: string,
    @Query('trxref')
    trxref?: string,
  ): Promise<PaymentResponseDto> {
    const paymentReference = reference?.trim() || trxref?.trim();

    if (!paymentReference) {
      throw new BadRequestException('Payment reference is required.');
    }

    return this.paymentsService.verifyByReference(paymentReference);
  }

  // ---------------------------------------------------------------------------
  // WEBHOOK
  // ---------------------------------------------------------------------------

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Message('Payment webhook processed successfully')
  @ApiOperation({
    summary: 'Paystack webhook',
  })
  @ApiHeader({
    name: 'x-paystack-signature',
    required: true,
  })
  async webhook(
    @Req()
    req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature')
    signature?: string,
  ): Promise<{
    received: true;
  }> {
    /**
     * Paystack signature verification requires the EXACT raw request body.
     *
     * Do not JSON.stringify(req.body) here.
     */
    const rawBody = req.rawBody;

    if (!rawBody) {
      throw new BadRequestException(
        'Raw request body is required for Paystack webhook verification.',
      );
    }

    await this.paymentsService.handleWebhook(
      rawBody.toString('utf8'),
      signature,
    );

    /**
     * Return 200 so Paystack knows the webhook was received.
     */
    return {
      received: true,
    };
  }

  // ---------------------------------------------------------------------------
  // ADMIN REFUND
  // ---------------------------------------------------------------------------

  @Post('refund')
  @HttpCode(HttpStatus.ACCEPTED)
  @Message('Refund request queued for provider processing')
  @ApiBearerAuth()
  @Roles(ROLE.ADMIN)
  @ApiOperation({
    summary: 'Request a full refund for a successful payment',
    description:
      'Creates a durable refund attempt using a stable Paystack reference. The response remains REFUND_PENDING until Paystack reports refund.processed; stock and vendor earnings are reversed only after that terminal event.',
  })
  @ApiBody({
    type: RefundPaymentDto,
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    type: PaymentResponseDto,
  })
  async refund(
    @GetUser('id') adminId: string,
    @Body()
    dto: RefundPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.refund(dto.paymentId, adminId, dto.amount);
  }
}

@ApiTags('PAYMENTS')
@Controller('orders/:orderId/payment')
export class OrderPaymentCanonicalController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Message('Order payment details retrieved successfully')
  @Roles(ROLE.USER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get payment for an order (Canonical)',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order UUID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PaymentResponseDto,
  })
  async findByOrder(
    @GetUser('id') userId: string,
    @Param(
      'orderId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    orderId: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.findByOrder(userId, orderId);
  }
}
