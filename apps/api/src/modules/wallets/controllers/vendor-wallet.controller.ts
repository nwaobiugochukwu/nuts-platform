// vendor-wallet.controller.ts

import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';

import { GetVendor } from '@api/common/decorators/get-vendor.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import {
  ApiResponseDto,
  PaginationMetaDto,
} from '@api/common/dto/api-response.dto';
import { WalletTransactionResponseDto } from '@api/modules/wallet/dto/wallet-transaction-response.dto';
import { WalletService } from '@api/modules/wallet/wallet.service';
import { VendorWalletResponseDto } from '../dto/vendor-wallet-response.dto';

@ApiTags('VENDOR - WALLET')
@Controller('vendors/wallet')
@Roles(ROLE.VENDOR)
@ApiBearerAuth('JWT-auth')
export class VendorWalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @Message('Wallet retrieved successfully')
  @ApiOperation({
    summary: 'Get vendor wallet',
    description:
      'Returns the authenticated vendor wallet balance, pending balance, lifetime earnings, and last 20 wallet transactions ordered by creation date descending.',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorWalletResponseDto>,
    description:
      'Vendor wallet with balance, pending, lifetime earnings, and transactions',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
  })
  async getWallet(
    @GetVendor('id') vendorId: string,
  ): Promise<VendorWalletResponseDto> {
    // The service owns the database query and enforces the transaction
    // limit, keeping this controller free of persistence logic.
    return this.walletService.getVendorWalletWithTransactions(vendorId, 20);
  }

  @Get('transactions')
  @Message('Transactions retrieved successfully')
  @ApiOperation({
    summary: 'Get vendor wallet transactions',
    description:
      'Returns paginated transaction history for the authenticated vendor wallet.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 20, max: 100)',
    example: 20,
  })
  @ApiOkResponse({
    type: ApiResponseDto<WalletTransactionResponseDto[]>,
    description: 'Paginated wallet transactions',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
  })
  async getTransactions(
    @GetVendor('id') vendorId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    data: WalletTransactionResponseDto[];
    meta: PaginationMetaDto;
  }> {
    // Query parameters arrive as strings. Clamp them here so malformed
    // values cannot accidentally create huge database queries.
    const parsedPage = Number.parseInt(page ?? '', 10);
    const parsedLimit = Number.parseInt(limit ?? '', 10);

    const safePage = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;

    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(1, parsedLimit), 100)
      : 20;

    return this.walletService.getVendorWalletTransactionsPaginated(
      vendorId,
      safePage,
      safeLimit,
    );
  }
}
