// vendor-product-variants.controller.ts

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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateVariantDto } from '@api/modules/products/dto/create-variant.dto';
import { UpdateVariantStockDto } from '@api/modules/products/dto/update-variant-stock.dto';
import { UpdateVariantDto } from '@api/modules/products/dto/update-variant.dto';
import { ProductVariantListResponseDto } from '@api/modules/products/dto/variant-response.dto';
import { VariantStockUpdateResponseDto } from '@api/modules/products/dto/variant-stock-update-response.dto';
import { VendorVariantResponseDto } from '@api/modules/products/dto/vendor-variant-response.dto';
import { ProductVariantsService } from '@api/modules/products/services/product-variants.service';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { GetVendor } from '@api/common/decorators/get-vendor.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@ApiTags('VENDOR - PRODUCT VARIANTS')
@Controller('vendors/products')
@Roles(ROLE.VENDOR)
@ApiBearerAuth('JWT-auth')
export class VendorProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

  @Patch('variants/:id')
  @Message('Product variant updated successfully')
  @ApiOperation({
    summary: 'Update a product variant for your product',
    description: 'Update a variant that belongs to one of your products.',
  })
  @ApiParam({
    name: 'id',
    description: 'Variant ID',
  })
  @ApiBody({
    type: UpdateVariantDto,
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorVariantResponseDto>,
    description: 'Updated variant',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiNotFoundResponse({
    description: 'Variant not found',
  })
  async update(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<VendorVariantResponseDto> {
    return this.productVariantsService.updateForVendor(vendorId, id, dto);
  }

  @Patch('variants/:id/deactivate')
  @Message('Product variant deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate a product variant for your product',
    description: 'Disable a variant that belongs to one of your products.',
  })
  @ApiParam({
    name: 'id',
    description: 'Variant ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorVariantResponseDto>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiNotFoundResponse({
    description: 'Variant not found',
  })
  async deactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorVariantResponseDto> {
    return this.productVariantsService.deactivateForVendor(vendorId, id);
  }

  @Patch('variants/:id/reactivate')
  @Message('Product variant reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate a product variant for your product',
    description: 'Restore a previously deactivated or soft deleted variant.',
  })
  @ApiParam({
    name: 'id',
    description: 'Variant ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorVariantResponseDto>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiNotFoundResponse({
    description: 'Variant not found',
  })
  async reactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorVariantResponseDto> {
    return this.productVariantsService.reactivateForVendor(vendorId, id);
  }

  @Delete('variants/:id')
  @HttpCode(HttpStatus.OK)
  @Message('Product variant permanently deleted successfully')
  @ApiOperation({
    summary: 'Permanently delete a product variant for your product',
    description:
      'Permanently remove a variant that belongs to one of your products.',
  })
  @ApiParam({
    name: 'id',
    description: 'Variant ID',
  })
  @ApiOkResponse({
    type: ApiResponseDto<null>,
    description: 'Variant permanently deleted',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiNotFoundResponse({
    description: 'Variant not found',
  })
  async delete(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.productVariantsService.permanentRemoveForVendor(vendorId, id);

    return null;
  }

  @Patch('variants/:id/stock')
  @Message('Product variant stock updated successfully')
  @ApiOperation({
    summary: 'Adjust stock for your product variant',
    description:
      "Apply a delta adjustment to one of your product variants' stock quantity. " +
      'Use a positive integer to add stock, a negative integer to subtract. ' +
      'Returns the updated stock level along with its availability status.',
  })
  @ApiParam({
    name: 'id',
    description: 'Variant ID',
  })
  @ApiBody({
    type: UpdateVariantStockDto,
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VariantStockUpdateResponseDto>,
    description: 'Stock updated successfully',
  })
  @ApiBadRequestResponse({
    description: 'Insufficient stock or invalid quantity',
  })
  @ApiForbiddenResponse({
    description: 'You do not own this variant',
  })
  @ApiNotFoundResponse({
    description: 'Variant not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async updateStock(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantStockDto,
  ): Promise<VariantStockUpdateResponseDto> {
    return this.productVariantsService.updateStockForVendor(vendorId, id, dto);
  }

  @Get(':productId/variants')
  @Message('Product variants retrieved successfully')
  @ApiOperation({
    summary: 'List all variants for your product',
    description:
      'Retrieve all variants belonging to a specific product owned by the vendor.',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<ProductVariantListResponseDto>,
  })
  findAll(
    @GetVendor('id') vendorId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductVariantListResponseDto> {
    return this.productVariantsService.findAllForVendor(vendorId, productId);
  }

  @Post(':productId/variants')
  @Message('Product variant created successfully')
  @ApiOperation({
    summary: 'Create a variant for your product',
    description:
      'Add a new variant to one of your own products using the canonical hierarchy.',
  })
  @ApiResponse({
    status: 201,
    type: ApiResponseDto<VendorVariantResponseDto>,
  })
  create(
    @GetVendor('id') vendorId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<VendorVariantResponseDto> {
    return this.productVariantsService.createForVendor(
      vendorId,
      productId,
      dto,
    );
  }
}
