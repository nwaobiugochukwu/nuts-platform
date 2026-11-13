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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { AdminCreateProductDto } from '@api/modules/products/dto/admin-create-product.dto';
import { AdminProductResponseDto } from '@api/modules/products/dto/admin-product-response.dto';
import { ProductReactivateResponseDto } from '@api/modules/products/dto/product-reactivate-response.dto';
import { ProductResponseDto } from '@api/modules/products/dto/product-response.dto';
import { QueryProductDto } from '@api/modules/products/dto/query-product.dto';
import { StockUpdateResponseDto } from '@api/modules/products/dto/stock-update-response.dto';
import { UpdateProductDto } from '@api/modules/products/dto/update-product.dto';
import { UpdateStockDto } from '@api/modules/products/dto/update-stock.dto';
import { ProductsService } from '@api/modules/products/products.service';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@ApiTags('ADMIN - PRODUCTS')
@ApiBearerAuth('JWT-auth')
@Controller('admin/products')
@Roles(ROLE.ADMIN)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // CREATE PRODUCT
  @Post()
  @Message('Product created successfully')
  @ApiOperation({
    summary: 'Create product',
    description: 'Create a new product with the provided details.',
  })
  @ApiBody({ type: AdminCreateProductDto })
  @ApiResponse({ status: 201, type: ApiResponseDto<AdminProductResponseDto> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  @ApiBadRequestResponse({
    description: 'Validation error â€” invalid input data.',
  })
  async create(
    @GetUser('id') adminId: string,
    @Body() dto: AdminCreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.create(dto, adminId);
  }

  @Get()
  @Message('Products retrieved successfully')
  @ApiOperation({
    summary: 'List products (admin, cursor or page pagination)',
    description:
      'Cursor or page-based pagination. Filter by search, isActive, isDeleted, category, or vendor.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  async findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAllForAdmin(query);
  }

  /** Cursor-based query â€” filters travel in the request body. Alias for GET. */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @Message('Products retrieved successfully')
  @ApiOperation({
    summary: 'List products (cursor pagination, filters in body)',
    description:
      'Fetches products using cursor pagination. Filters (search, isActive, isDeleted) travel in the request body.',
  })
  async query(@Body() body: QueryProductDto) {
    return this.productsService.findAllForAdmin(body);
  }

  // GET BY ID (ADMIN ONLY)
  @Get(':id')
  @Message('Product retrieved successfully')
  @ApiOperation({
    summary: 'Get product by ID (admin)',
    description:
      'Returns any product by ID, including soft-deleted and inactive. Public category routes only expose active, non-deleted products.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminProductResponseDto> })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminProductResponseDto> {
    return this.productsService.findOneForAdmin(id);
  }

  /** Stock adjustment audit trail (newest first). */
  @Get(':id/stock-history')
  @Message('Stock history retrieved successfully')
  @ApiOperation({
    summary: 'Get stock adjustment history for a product',
    description:
      'Returns the audit trail of all stock adjustments for a product, newest first.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Stock history entries' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async getStockHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getStockHistory(id);
  }

  @Patch(':id/stock')
  @Message('Stock updated successfully')
  @ApiOperation({
    summary: 'Adjust product stock',
    description:
      'Update stock. Positive quantity to restock, negative to deduct. This is the only way to modify stock.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiBody({ type: UpdateStockDto })
  @ApiResponse({ status: 200, type: ApiResponseDto<StockUpdateResponseDto> })
  @ApiBadRequestResponse({
    description: 'Validation error or insufficient stock.',
  })
  async updateStock(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ): Promise<StockUpdateResponseDto> {
    return this.productsService.updateStock(
      id,
      dto.quantity,
      adminId,
      dto.description,
    );
  }

  @Patch(':id')
  @Message('Product updated successfully')
  @ApiOperation({
    summary: 'Update product fields',
    description: 'Stock is managed via the dedicated stock endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({ status: 200, type: ApiResponseDto<AdminProductResponseDto> })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async update(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<AdminProductResponseDto> {
    return this.productsService.update(id, dto, adminId);
  }

  // DEACTIVATE PRODUCT
  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Product deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate product',
    description: 'Deactivate a product, removing it from public visibility.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async deactivate(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.productsService.deactivate(id, adminId);
  }

  // REACTIVATE PRODUCT
  @Patch(':id/reactivate')
  @Message('Product reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate product',
    description: 'Reactivate a previously deactivated product.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<ProductReactivateResponseDto>,
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async reactivate(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductReactivateResponseDto> {
    return this.productsService.reactivate(id, adminId);
  }

  // DELETE PRODUCT
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Message('Product permanently deleted')
  @ApiOperation({
    summary: 'Permanently delete product',
    description: 'Permanently delete a product and all associated data.',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async remove(
    @GetUser('id') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.productsService.permanentRemove(id, adminId);
  }
}
