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
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

import { CartService } from '../cart.service';

import { AddToCartQuantityDto } from '../dto/add-to-cart-quantity.dto';
import { UpdateCartItemDto } from '../dto/update-cart-item.dto';

import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { AddToCartResponseDto } from '../dto/responses/add-to-cart.response';
import { ClearCartResponseDto } from '../dto/responses/clear-cart.response';
import { GetCartResponseDto } from '../dto/responses/get-cart.response';
import { RemoveCartItemResponseDto } from '../dto/responses/remove-cart-item.response';
import { UpdateCartItemResponseDto } from '../dto/responses/update-cart-item.response';

@ApiTags('CART')
@ApiBearerAuth('JWT-auth')
@Controller('cart')
@Roles(ROLE.USER)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  /**
   * Returns the authenticated user's active cart.
   *
   * The controller is intentionally thin:
   * authentication/HTTP concerns stay here while business logic
   * remains inside CartService.
   */
  @Get()
  @Message('Cart retrieved successfully')
  @ApiOperation({
    summary: 'Get current cart',
    description:
      "Retrieves the authenticated user's active cart with product and variant information.",
  })
  @ApiOkResponse({
    type: ApiResponseDto<GetCartResponseDto>,
  })
  @ApiUnauthorizedResponse({
    description: 'User is not authenticated',
  })
  getCart(@GetUser('id') userId: string): Promise<GetCartResponseDto> {
    return this.cartService.getCart(userId);
  }

  @Get('discount-preview')
  @Message('Discount preview retrieved successfully')
  @ApiOperation({
    summary: 'Preview a discount code',
  })
  @ApiQuery({
    name: 'code',
    required: true,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or missing discount code',
  })
  previewDiscount(@GetUser('id') userId: string, @Query('code') code?: string) {
    const normalizedCode = code?.trim();

    if (!normalizedCode) {
      throw new BadRequestException('A discount code is required');
    }

    return this.cartService.previewDiscount(userId, normalizedCode);
  }

  @Post('items/:productId')
  @Message('Item added to cart')
  @ApiOperation({
    summary: 'Add a product to the cart',
    description: 'Adds a product or product variant to the active cart.',
  })
  @ApiParam({
    name: 'productId',
    description: 'Product UUID',
  })
  @ApiQuery({
    name: 'variantId',
    required: false,
    description: 'Optional variant UUID',
  })
  @ApiBody({
    type: AddToCartQuantityDto,
  })
  @ApiCreatedResponse({
    type: ApiResponseDto<AddToCartResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'Product or variant not found',
  })
  @ApiBadRequestResponse({
    description: 'Invalid quantity, variant or insufficient stock',
  })
  addToCart(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('variantId') queryVariantId: string | undefined,
    @Body() dto: AddToCartQuantityDto,
  ): Promise<AddToCartResponseDto> {
    /*
     * Body takes precedence over query parameter.
     * This keeps the API backward compatible while allowing
     * variantId to be supplied in the request body.
     */
    const variantId = dto.variantId?.trim() || queryVariantId?.trim();

    return this.cartService.addToCart(
      userId,
      productId,
      dto.quantity,
      variantId,
      dto.recommendationContext,
    );
  }

  @Patch('items/:productId')
  @Message('Cart item updated')
  @ApiOperation({
    summary: 'Update cart item quantity',
    description:
      'Increases or decreases an existing cart item quantity. Quantity reaching zero removes the item.',
  })
  @ApiParam({
    name: 'productId',
    description: 'Product UUID',
  })
  @ApiQuery({
    name: 'variantId',
    required: false,
  })
  @ApiBody({
    type: UpdateCartItemDto,
  })
  @ApiOkResponse({
    type: ApiResponseDto<UpdateCartItemResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'Cart item not found',
  })
  @ApiBadRequestResponse({
    description: 'Invalid quantity or insufficient stock',
  })
  updateItem(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('variantId') queryVariantId: string | undefined,
    @Body() dto: UpdateCartItemDto,
  ): Promise<UpdateCartItemResponseDto> {
    const variantId = dto.variantId?.trim() || queryVariantId?.trim();

    return this.cartService.updateItem(userId, productId, variantId, dto);
  }

  @Delete('items/:productId')
  @HttpCode(HttpStatus.OK)
  @Message('Item removed from cart')
  @ApiOperation({
    summary: 'Remove an item from the cart',
  })
  @ApiParam({
    name: 'productId',
    description: 'Product UUID',
  })
  @ApiQuery({
    name: 'variantId',
    required: false,
  })
  @ApiOkResponse({
    type: ApiResponseDto<RemoveCartItemResponseDto>,
  })
  @ApiNotFoundResponse({
    description: 'Cart item not found',
  })
  removeItem(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('variantId') variantId?: string,
  ): Promise<RemoveCartItemResponseDto> {
    return this.cartService.removeItem(userId, productId, variantId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @Message('Cart cleared successfully')
  @ApiOperation({
    summary: 'Clear the current cart',
  })
  @ApiOkResponse({
    type: ApiResponseDto<ClearCartResponseDto>,
  })
  clearCart(@GetUser('id') userId: string): Promise<ClearCartResponseDto> {
    return this.cartService.clearCart(userId);
  }
}
