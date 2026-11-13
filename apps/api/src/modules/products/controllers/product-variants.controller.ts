import {
  BadRequestException,
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
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ApiBearerAuth } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { Public } from '@api/common/decorators/public.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ProductVariantsService } from '../product-variants.service';

import { CreateVariantDto } from '../dto/create-variant.dto';
import { QueryVariantDto } from '../dto/query-variant.dto';
import { UpdateVariantStockDto } from '../dto/update-variant-stock.dto';
import { UpdateVariantDto } from '../dto/update-variant.dto';

import {
  AllVariantsResponseDto,
  VariantResponseDto,
  VariantStockUpdateResponseDto,
} from '../dto/variant-response.dto';

@ApiTags('PRODUCT VARIANTS')
@Controller('variants')
export class ProductVariantsController {
  constructor(private readonly variantsService: ProductVariantsService) {}

  /**
   * Public paginated variants.
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get active product variants',
  })
  @ApiOkResponse({
    type: AllVariantsResponseDto,
  })
  @ApiBadRequestResponse()
  async findAll(@Query() query: QueryVariantDto) {
    if (query.productId && query.variantId) {
      throw new BadRequestException(
        'productId and variantId cannot be used together',
      );
    }

    if (query.variantId) {
      return this.variantsService.findOne(query.variantId);
    }

    if (query.productId) {
      return this.variantsService.findAll(query.productId);
    }

    return this.variantsService.findAllPaginated(query.page, query.limit);
  }

  /**
   * Public single variant.
   */
  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get a single active product variant',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: VariantResponseDto,
  })
  @ApiNotFoundResponse()
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.variantsService.findOne(id);
  }

  /**
   * Create a variant.
   *
   * Protect this route with your existing vendor/admin guards
   * exactly as your current controller does.
   */
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @ApiBearerAuth('JWT-auth')
  @Post(':productId')
  @ApiOperation({
    summary: 'Create a product variant',
  })
  @ApiParam({
    name: 'productId',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: VariantResponseDto,
  })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async create(
    @Param('productId', ParseUUIDPipe)
    productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.variantsService.createVariant(productId, dto);
  }

  /**
   * Update variant metadata.
   */
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @ApiBearerAuth('JWT-auth')
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a product variant',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: VariantResponseDto,
  })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiNotFoundResponse()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variantsService.updateVariant(id, dto);
  }

  /**
   * Atomic stock adjustment.
   */
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @ApiBearerAuth('JWT-auth')
  @Patch(':id/stock')
  @ApiOperation({
    summary: 'Adjust variant stock',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: VariantStockUpdateResponseDto,
  })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  async updateStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantStockDto,
  ) {
    return this.variantsService.updateStock(id, dto);
  }

  /**
   * Soft delete.
   */
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @ApiBearerAuth('JWT-auth')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft delete a product variant',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse()
  @ApiNotFoundResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.variantsService.softDeleteVariant(id);
  }

  /**
   * Restore a soft-deleted variant.
   */
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @ApiBearerAuth('JWT-auth')
  @Patch(':id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a product variant',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: VariantResponseDto,
  })
  @ApiNotFoundResponse()
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.variantsService.reactivateVariant(id);
  }
}
