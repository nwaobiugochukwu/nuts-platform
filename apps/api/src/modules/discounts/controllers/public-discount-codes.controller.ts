import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Message } from '@api/common/decorators/message.decorator';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { OptionalAuth } from '@api/common/decorators/optional-auth.decorator';
import { DiscountCodeService } from '../discount-code.service';
import {
  BatchProductDiscountsDto,
  PublicPlatformPromoDto,
  PublicProductDealDto,
} from '../dto/public-discount.dto';

@ApiTags('DISCOUNTS')
@Controller('public/discounts')
export class PublicDiscountCodesController {
  constructor(private readonly discountCodeService: DiscountCodeService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({
    summary:
      'Get active platform-wide discount codes for storefront announcement banner',
  })
  @Message('Active platform promotions retrieved successfully')
  getPlatformPromos(
    @GetUser('id') userId?: string,
  ): Promise<PublicPlatformPromoDto[]> {
    return this.discountCodeService.getPublicPlatformPromos(userId);
  }

  @Get('products/:productId')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get highest-saving deal and applicable vouchers for a product',
  })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @Message('Product deal details retrieved successfully')
  getProductDeals(
    @Param('productId', ParseUUIDPipe) productId: string,
    @GetUser('id') userId?: string,
  ): Promise<PublicProductDealDto> {
    return this.discountCodeService.getPublicProductDeals(productId, userId);
  }

  @Post('products/batch')
  @OptionalAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch fetch best applicable discount deal for up to 100 products',
  })
  @Message('Batch product discounts retrieved successfully')
  getBatchProductDeals(
    @Body() dto: BatchProductDiscountsDto,
    @GetUser('id') userId?: string,
  ) {
    return this.discountCodeService.getBatchProductDeals(dto, userId);
  }
}
