// vendor-products.controller.ts

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { CreateProductDto } from '@api/modules/products/dto/create-product.dto';
import { ProductReactivateResponseDto } from '@api/modules/products/dto/product-reactivate-response.dto';
import { QueryProductDto } from '@api/modules/products/dto/query-product.dto';
import { StockUpdateResponseDto } from '@api/modules/products/dto/stock-update-response.dto';
import { UpdateProductDto } from '@api/modules/products/dto/update-product.dto';
import { UpdateStockDto } from '@api/modules/products/dto/update-stock.dto';
import { VendorProductResponseDto } from '@api/modules/products/dto/vendor-product-response.dto';
import { ProductsService } from '@api/modules/products/products.service';
import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { GetVendor } from '@api/common/decorators/get-vendor.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import {
  ApiResponseDto,
  PaginationMetaDto,
} from '@api/common/dto/api-response.dto';

@ApiTags('VENDOR - PRODUCTS')
@ApiBearerAuth('JWT-auth')
@Controller('vendors/products')
@Roles(ROLE.VENDOR)
export class VendorProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Creates a product belonging to the authenticated vendor.
   *
   * The vendor ID comes exclusively from the authenticated JWT rather than
   * from the request body, preventing users from creating products for
   * another vendor.
   */
  @Post()
  @Message('Product created successfully')
  @ApiOperation({
    summary: 'Create product (vendor)',
    description:
      'Create a new product for your store under a specific category.',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description:
      'Optional Category UUID to assign the product to. Defaults to uncategorized if omitted.',
  })
  @ApiBody({ type: CreateProductDto })
  @ApiCreatedResponse({
    type: ApiResponseDto<VendorProductResponseDto>,
    description: 'Product created',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - validation error',
  })
  @ApiConflictResponse({
    description: 'Conflict - product slug already exists',
  })
  async create(
    @GetVendor('id') vendorId: string,
    @Body() dto: CreateProductDto,
    @Query('categoryId', new ParseUUIDPipe({ optional: true }))
    categoryId?: string,
  ): Promise<VendorProductResponseDto> {
    // Query parameters override the optional DTO category so the endpoint
    // has one clear source of truth when categoryId is explicitly supplied.
    if (categoryId) {
      dto.categoryId = categoryId;
    }

    return this.productsService.createForVendor(vendorId, dto);
  }

  @Get()
  @Message('Products retrieved successfully')
  @ApiOperation({
    summary: 'List your products (vendor)',
    description: 'Paginated list of your products (page/limit, max 100).',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorProductResponseDto[]>,
    description: 'Paginated list of your products',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async findAll(
    @GetVendor('id') vendorId: string,
    @Query() query: QueryProductDto,
  ): Promise<{
    data: VendorProductResponseDto[];
    meta: PaginationMetaDto;
  }> {
    return this.productsService.findAllForVendor(vendorId, query);
  }

  @Get(':slug')
  @Message('Product retrieved successfully')
  @ApiOperation({
    summary: 'Get your product by slug (vendor)',
    description: 'Retrieve one of your products by its slug.',
  })
  @ApiParam({
    name: 'slug',
    description: 'Product slug',
  })
  @ApiOkResponse({
    type: ApiResponseDto<VendorProductResponseDto>,
    description: 'Product details',
  })
  @ApiNotFoundResponse({
    description: 'Product not found',
  })
  async findBySlug(
    @GetVendor('id') vendorId: string,
    @Param('slug') slug: string,
  ): Promise<VendorProductResponseDto> {
    return this.productsService.findOneForVendor(slug, vendorId);
  }

  @Patch(':id')
  @Message('Product updated successfully')
  @ApiOperation({
    summary: 'Update product (vendor)',
    description:
      'Update product fields. Stock is managed via the dedicated stock endpoint.',
  })
  @ApiParam({
    name: 'id',
    description: 'Product ID',
  })
  @ApiBody({
    type: UpdateProductDto,
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<VendorProductResponseDto>,
    description: 'Updated product',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - validation error',
  })
  @ApiNotFoundResponse({
    description: 'Product not found',
  })
  @ApiConflictResponse({
    description: 'Conflict - duplicate slug',
  })
  async update(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<VendorProductResponseDto> {
    // Ownership is checked before the mutation so a vendor can never
    // update another vendor's product by guessing its UUID.
    await this.assertProductOwnership(vendorId, id);

    return this.productsService.update(id, dto, vendorId);
  }

  @Patch(':id/stock')
  @Message('Stock updated successfully')
  @ApiOperation({
    summary: 'Adjust product stock (vendor)',
    description:
      'Update stock. Positive quantity to restock, negative to deduct. This is the only way to modify stock.',
  })
  @ApiParam({
    name: 'id',
    description: 'Product ID',
  })
  @ApiBody({
    type: UpdateStockDto,
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<StockUpdateResponseDto>,
    description: 'Updated stock',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - validation error',
  })
  async updateStock(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ): Promise<StockUpdateResponseDto> {
    await this.assertProductOwnership(vendorId, id);

    return this.productsService.updateStock(
      id,
      dto.quantity,
      undefined,
      dto.description,
    );
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Product deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate product (vendor)',
    description: 'Hide product from storefront but keep it in the database.',
  })
  @ApiParam({
    name: 'id',
    description: 'Product ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Deactivated product',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - not your product',
  })
  @ApiNotFoundResponse({
    description: 'Product not found',
  })
  async deactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.assertProductOwnership(vendorId, id);

    await this.productsService.deactivate(id);

    return null;
  }

  @Patch(':id/reactivate')
  @Message('Product reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate product (vendor)',
    description: 'Show product on storefront.',
  })
  @ApiParam({
    name: 'id',
    description: 'Product ID',
  })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<ProductReactivateResponseDto>,
    description: 'Reactivated product',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - not your product',
  })
  @ApiNotFoundResponse({
    description: 'Product not found',
  })
  async reactivate(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductReactivateResponseDto> {
    await this.assertProductOwnership(vendorId, id);

    return this.productsService.reactivate(id);
  }

  @Delete(':id/permanent')
  @HttpCode(HttpStatus.OK)
  @Message('Product permanently deleted')
  @ApiOperation({
    summary: 'Permanently delete product (vendor)',
    description: 'Irreversibly remove a product from the database.',
  })
  @ApiParam({
    name: 'id',
    description: 'Product ID',
  })
  @ApiOkResponse({
    type: ApiResponseDto<null>,
    description: 'Product permanently deleted',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - not your product',
  })
  @ApiNotFoundResponse({
    description: 'Product not found',
  })
  async permanentRemove(
    @GetVendor('id') vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<null> {
    await this.assertProductOwnership(vendorId, id);

    await this.productsService.permanentRemove(id);

    return null;
  }

  /**
   * Performs a minimal ownership lookup.
   *
   * Only vendorId is selected because loading the entire product would
   * waste database I/O and network bandwidth for a simple authorization
   * check.
   */
  private async assertProductOwnership(
    vendorId: string,
    productId: string,
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      select: {
        vendorId: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.vendorId !== vendorId) {
      throw new ForbiddenException(
        'You do not have permission to manage this product',
      );
    }
  }
}
