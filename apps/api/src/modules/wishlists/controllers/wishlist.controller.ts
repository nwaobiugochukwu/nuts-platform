import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
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

import { AddToWishlistDto, WishlistResponseDto } from '../dto/wishlist.dto';

import { ROLE } from '@prisma/client';
import { Roles } from '@api/common/decorators/role.decorator';
import { WishlistService } from '../wishlist.service';

@ApiTags('WISHLIST')
@ApiBearerAuth('JWT-auth')
@Controller('wishlist')
@Roles(ROLE.USER)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Post('items/:productId')
  @Message('Item added to wishlist')
  @ApiOperation({
    summary: 'Add a product or variant to wishlist',
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
    type: AddToWishlistDto,
  })
  @ApiCreatedResponse({
    type: ApiResponseDto<WishlistResponseDto>,
  })
  @ApiConflictResponse({
    description: 'Item already exists in wishlist',
  })
  @ApiNotFoundResponse({
    description: 'Product or variant not found',
  })
  add(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe)
    productId: string,
    @Query('variantId')
    queryVariantId?: string,
    @Body()
    dto?: AddToWishlistDto,
  ): Promise<WishlistResponseDto> {
    /*
     * Supporting both query and body keeps compatibility with your
     * existing frontend while the service receives one normalized value.
     */
    const variantId = dto?.variantId?.trim() || queryVariantId?.trim();

    return this.wishlistService.add(userId, productId, variantId);
  }

  @Get()
  @Message('Wishlist retrieved successfully')
  @ApiOperation({
    summary: 'Get current wishlist',
  })
  @ApiOkResponse({
    type: ApiResponseDto<WishlistResponseDto[]>,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  findMine(@GetUser('id') userId: string): Promise<WishlistResponseDto[]> {
    return this.wishlistService.findMine(userId);
  }

  @Delete('items/:productId')
  @Message('Item removed from wishlist')
  @ApiOperation({
    summary: 'Remove an item from wishlist',
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
    type: ApiResponseDto<null>,
  })
  @ApiNotFoundResponse({
    description: 'Wishlist item not found',
  })
  async remove(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe)
    productId: string,
    @Query('variantId')
    variantId?: string,
  ): Promise<null> {
    await this.wishlistService.remove(userId, productId, variantId);

    return null;
  }
}
