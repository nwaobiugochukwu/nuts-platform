import {
  Body,
  Controller,
  Get,
  Header,
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

  @Get('campaigns')
  @OptionalAuth()
  @ApiOperation({
    summary:
      'Get active platform-wide discount campaigns for storefront announcement banner',
  })
  @Message('Active platform promotions retrieved successfully')
  getPlatformPromos(
    @GetUser('id') userId?: string,
  ): Promise<PublicPlatformPromoDto[]> {
    return this.discountCodeService.getPublicPlatformPromos(userId);
  }

  @Get(':productId/available-product-deals-and-vouchers')
  @OptionalAuth()
  @Header(
    'Cache-Control',
    'public, max-age=60, s-maxage=120, stale-while-revalidate=60',
  )
  @ApiOperation({
    summary:
      'Get available deals, vouchers and highest-saving discount for a product',
  })
  @ApiParam({
    name: 'productId',
    description: 'Product UUID',
  })
  @Message('Available product deals and vouchers retrieved successfully')
  getProductDeals(
    @Param('productId', ParseUUIDPipe) productId: string,
    @GetUser('id') userId?: string,
  ): Promise<PublicProductDealDto> {
    return this.discountCodeService.getPublicProductDeals(productId, userId);
  }

  @Post('best-value-deal')
  @OptionalAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Fetch best value applicable discount deals (single product or batch up to 100 products)',
  })
  @Message('Best value product deals retrieved successfully')
  getDeals(
    @Body() dto: BatchProductDiscountsDto,
    @GetUser('id') userId?: string,
  ) {
    if (dto.productId && (!dto.productIds || dto.productIds.length === 0)) {
      return this.discountCodeService.getPublicProductDeals(
        dto.productId,
        userId,
      );
    }
    return this.discountCodeService.getBatchProductDeals(
      { productIds: dto.productIds ?? (dto.productId ? [dto.productId] : []) },
      userId,
    );
  }
}
