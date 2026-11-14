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
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { AdminVariantResponseDto } from '@api/modules/product-variants/dto/admin-variant-response.dto';
import { CreateVariantDto } from '@api/modules/product-variants/dto/create-variant.dto';
import { UpdateVariantStockDto } from '@api/modules/product-variants/dto/update-variant-stock.dto';
import { UpdateVariantDto } from '@api/modules/product-variants/dto/update-variant.dto';
import { VariantStockUpdateResponseDto } from '@api/modules/product-variants/dto/variant-stock-update-response.dto';
import { ProductVariantsService } from '@api/modules/product-variants/product-variants.service';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@ApiTags('ADMIN - PRODUCT VARIANTS')
@ApiBearerAuth('JWT-auth')
@Controller('admin/products/variants')
@Roles(ROLE.ADMIN)
export class AdminProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

  @Post(':productId')
  @Message('Product variant created successfully')
  @ApiOperation({ summary: 'Create a variant for a product (Admin)' })
  @ApiResponse({ status: 201, type: ApiResponseDto<AdminVariantResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<AdminVariantResponseDto> {
    return this.productVariantsService.create(productId, dto);
  }

  @Patch(':id')
  @Message('Product variant updated successfully')
  @ApiOperation({ summary: 'Update a product variant (Admin)' })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminVariantResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<AdminVariantResponseDto> {
    return this.productVariantsService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Message('Product variant deactivated successfully')
  @ApiOperation({ summary: 'Deactivate a product variant (Admin)' })
  @ApiParam({ name: 'id', description: 'Variant ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminVariantResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVariantResponseDto> {
    return this.productVariantsService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Message('Product variant reactivated successfully')
  @ApiOperation({ summary: 'Reactivate a product variant (Admin)' })
  @ApiParam({ name: 'id', description: 'Variant ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminVariantResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVariantResponseDto> {
    return this.productVariantsService.reactivate(id);
  }

  @Patch(':id/stock')
  @Message('Product variant stock updated successfully')
  @ApiOperation({
    summary: 'Adjust stock for a product variant',
    description:
      "Apply a delta adjustment to a variant's stock quantity. " +
      'Use a positive integer to add stock, a negative integer to subtract. ' +
      'Returns the updated stock level along with its availability status.',
  })
  @ApiParam({ name: 'id', description: 'Variant ID' })
  @ApiBody({ type: UpdateVariantStockDto })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VariantStockUpdateResponseDto>,
    description: 'Stock updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Insufficient stock or invalid quantity',
  })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  async updateStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantStockDto,
  ): Promise<VariantStockUpdateResponseDto> {
    return this.productVariantsService.updateStock(
      id,
      dto.quantity,
      dto.description,
    );
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.OK)
  @Message('Product variant permanently deleted successfully')
  @ApiOperation({ summary: 'Permanently delete a product variant (Admin)' })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden â€” user does not have ADMIN role.',
  })
  @ApiOkResponse({
    type: ApiResponseDto<null>,
    description: 'Product variant permanently deleted successfully',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    await this.productVariantsService.permanentRemove(id);
    return null;
  }
}

@ApiTags('ADMIN - PRODUCT VARIANTS')
@ApiBearerAuth('JWT-auth')
@Controller('admin/products/:productId/variants')
@Roles(ROLE.ADMIN)
export class AdminProductVariantsCanonicalController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

  @Get()
  @Message('Product variants retrieved successfully')
  @ApiOperation({
    summary: 'List all variants for a product (Admin Canonical)',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async findAll(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.productVariantsService.findAll(productId);
  }

  @Post()
  @Message('Product variant created successfully')
  @ApiOperation({ summary: 'Create a variant for a product (Admin Canonical)' })
  @ApiResponse({ status: 201, type: ApiResponseDto<AdminVariantResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized — no valid JWT session.',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden — user does not have ADMIN role.',
  })
  async create(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<AdminVariantResponseDto> {
    return this.productVariantsService.create(productId, dto);
  }
}
