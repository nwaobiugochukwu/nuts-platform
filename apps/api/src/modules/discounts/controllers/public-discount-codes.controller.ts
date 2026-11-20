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
import { Public } from '@api/common/decorators/public.decorator';
import { DiscountCodeService } from '../discount-code.service';
import {
  BatchProductDiscountsDto,
  PublicPlatformPromoDto,
  PublicProductDealDto,
} from '../dto/public-discount.dto';

@ApiTags('DISCOUNTS')
@Public()
@Controller('discounts/public')
export class PublicDiscountCodesController {
  constructor(private readonly discountCodeService: DiscountCodeService) {}

  @Get('platform-promos')
  @ApiOperation({
    summary:
      'Get active platform-wide discount codes for storefront announcement banner',
  })
  @Message('Active platform promotions retrieved successfully')
  getPlatformPromos(): Promise<PublicPlatformPromoDto[]> {
    return this.discountCodeService.getPublicPlatformPromos();
  }

  @Get('for-product/:productId')
  @ApiOperation({
    summary: 'Get highest-saving deal and applicable vouchers for a product',
  })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @Message('Product deal details retrieved successfully')
  getProductDeals(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<PublicProductDealDto> {
    return this.discountCodeService.getPublicProductDeals(productId);
  }

  @Post('batch-for-products')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch fetch best applicable discount deal for up to 100 products',
  })
  @Message('Batch product discounts retrieved successfully')
  getBatchProductDeals(@Body() dto: BatchProductDiscountsDto) {
    return this.discountCodeService.getBatchProductDeals(dto);
  }
}
