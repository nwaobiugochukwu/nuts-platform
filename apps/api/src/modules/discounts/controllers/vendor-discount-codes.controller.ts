// vendor-discount-codes.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';

import { DiscountCodeService } from '@api/modules/promotions/discount-code.service';
import {
  CreateVendorDiscountCodeDto,
  DiscountCodeResponseDto,
  UpdateVendorDiscountCodeDto,
} from '@api/modules/promotions/dto';
import { GetVendor } from '@api/common/decorators/get-vendor.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@ApiTags('VENDOR - DISCOUNT CODES')
@Controller('vendors/discounts')
@Roles(ROLE.VENDOR)
@ApiBearerAuth('JWT-auth')
export class VendorDiscountCodesController {
  constructor(private readonly discountCodeService: DiscountCodeService) {}

  @Post()
  @Message('Discount code created successfully')
  @ApiOperation({
    summary: 'Create a discount code for your products',
    description:
      'Create a new discount code for your products. Optionally restrict to specific products.',
  })
  @ApiBody({
    type: CreateVendorDiscountCodeDto,
  })
  @ApiResponse({
    status: 201,
    type: ApiResponseDto<DiscountCodeResponseDto>,
  })
  @ApiBadRequestResponse({
    description: 'Bad request - validation error',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden',
  })
  async create(
    @GetVendor('id') vendorId: string,
    @Body() dto: CreateVendorDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    return this.discountCodeService.createForVendor(vendorId, dto);
  }

  @Get()
  @Message('Discount codes retrieved successfully')
  @ApiOperation({
    summary: 'List your discount codes',
    description: 'Get all discount codes created by the authenticated vendor.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<DiscountCodeResponseDto[]>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async findAll(
    @GetVendor('id') vendorId: string,
  ): Promise<DiscountCodeResponseDto[]> {
    return this.discountCodeService.findAllForVendor(vendorId);
  }

  @Patch(':id')
  @Message('Discount code updated successfully')
  @ApiOperation({
    summary: 'Update one of your discount codes',
  })
  @ApiParam({
    name: 'id',
    description: 'Discount code ID',
  })
  @ApiBody({
    type: UpdateVendorDiscountCodeDto,
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<DiscountCodeResponseDto>,
  })
  @ApiBadRequestResponse({
    description: 'Bad request - validation error',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden',
  })
  @ApiNotFoundResponse({
    description: 'Discount code not found',
  })
  async update(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    return this.discountCodeService.updateForVendor(id, vendorId, dto);
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate a discount code',
    description: 'Deactivate one of your discount codes.',
  })
  @ApiParam({
    name: 'id',
    description: 'Discount code ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code deactivated',
  })
  @ApiNotFoundResponse({
    description: 'Discount code not found',
  })
  async deactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.discountCodeService.deactivate(id, vendorId, false);

    return null;
  }

  @Patch(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate a discount code',
    description: 'Reactivate an inactive discount code for your store.',
  })
  @ApiParam({
    name: 'id',
    description: 'Discount code ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code reactivated',
  })
  @ApiNotFoundResponse({
    description: 'Discount code not found',
  })
  async reactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.discountCodeService.reactivate(id, vendorId, false);

    return null;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code deleted successfully')
  @ApiOperation({
    summary: 'Delete a discount code',
    description:
      'Permanently delete a discount code. Cannot delete if it has been used.',
  })
  @ApiParam({
    name: 'id',
    description: 'Discount code ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code deleted',
  })
  @ApiBadRequestResponse({
    description: 'Cannot delete used discount code',
  })
  @ApiNotFoundResponse({
    description: 'Discount code not found',
  })
  async remove(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.discountCodeService.remove(id, vendorId, false);

    return null;
  }
}
