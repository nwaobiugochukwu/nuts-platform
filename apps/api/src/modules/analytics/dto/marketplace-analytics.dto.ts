import { ApiProperty } from '@nestjs/swagger';

export class TopFollowerStoreDto {
  @ApiProperty() vendorId!: string;
  @ApiProperty() storeName!: string;
  @ApiProperty() followerCount!: number;
}

export class MarketplaceAnalyticsSummaryDto {
  @ApiProperty({
    description: 'Recorded store-page view events in the selected period.',
  })
  storeViews!: number;
  @ApiProperty({
    description:
      'Distinct account or anonymous visitor/session identities with a store view in the selected period. Account and anonymous identities are not merged.',
  })
  uniqueStoreVisitors!: number;
  @ApiProperty({
    description: 'Recorded product-page view events in the selected period.',
  })
  productViews!: number;
  @ApiProperty({
    description:
      'Distinct account or anonymous visitor/session identities with a product view in the selected period. Account and anonymous identities are not merged.',
  })
  uniqueProductViewers!: number;
  @ApiProperty({
    description:
      'Recorded cart-add events in the selected period; repeated additions count as separate events.',
  })
  cartAdds!: number;
  @ApiProperty({
    description:
      'Distinct signed-in accounts with at least one cart-add event in the selected period.',
  })
  uniqueCartAdders!: number;
  @ApiProperty({
    description: 'Recorded cart-removal events in the selected period.',
  })
  cartRemovals!: number;
  @ApiProperty({
    description: 'Recorded wishlist-add events in the selected period.',
  })
  wishlistAdds!: number;
  @ApiProperty({
    description:
      'Distinct signed-in accounts with at least one wishlist-add event in the selected period.',
  })
  uniqueWishlistSavers!: number;
  @ApiProperty({
    description: 'Recorded wishlist-removal events in the selected period.',
  })
  wishlistRemovals!: number;
  @ApiProperty({
    description:
      'Distinct cart/product/variant lines added in the selected period.',
  })
  cartLinesAdded!: number;
  @ApiProperty({
    description:
      'Added cart/product/variant lines matched to a non-cancelled paid order within seven days of the latest add.',
  })
  cartLinesPurchased!: number;
  @ApiProperty({
    description:
      'Percentage of distinct cart/product/variant lines added in the period that matched a paid order within seven days.',
  })
  cartToPurchaseRate!: number;
  @ApiProperty({
    description:
      'Distinct signed-in account/product pairs with a product view in the selected period. Anonymous views are excluded from this conversion cohort.',
  })
  identifiedProductViewers!: number;
  @ApiProperty({
    description:
      'Identified account/product pairs with a later cart add within seven days of a view in the selected period.',
  })
  viewersToCart!: number;
  @ApiProperty({
    description:
      'Identified account/product pairs with a later non-cancelled paid order within seven days of a view in the selected period.',
  })
  viewersToPurchase!: number;
  @ApiProperty({
    description:
      'Percentage of identified account/product view pairs followed by a cart add within seven days.',
  })
  productViewToCartRate!: number;
  @ApiProperty({
    description:
      'Percentage of identified account/product view pairs followed by a non-cancelled paid order within seven days.',
  })
  productViewToPurchaseRate!: number;
  @ApiProperty({
    description: 'Current follow relationships for active, approved stores.',
  })
  currentFollowers!: number;
  @ApiProperty({
    description:
      'Distinct active users currently following active, approved stores.',
  })
  uniqueFollowers!: number;
  @ApiProperty({
    description: 'Follow events recorded during the selected period.',
  })
  newFollowers!: number;
  @ApiProperty({
    description: 'Unfollow events recorded during the selected period.',
  })
  unfollows!: number;
  @ApiProperty({ description: 'Net follow growth during the selected period.' })
  netFollowerGrowth!: number;
  @ApiProperty({ type: [TopFollowerStoreDto] })
  topFollowerStores!: TopFollowerStoreDto[];
  @ApiProperty({
    description:
      'Distinct non-cancelled orders with a successful, refund-pending, or refunded payment in the selected order-created period.',
  })
  paidOrders!: number;
  @ApiProperty({
    description:
      'Units from qualifying paid order lines created in the selected period.',
  })
  paidUnits!: number;
  @ApiProperty({
    description:
      'Gross product-line value from successful payments, before refunds.',
  })
  paidRevenue!: string;
}

export class VendorProductPerformanceDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    description:
      'Recorded product-page view events for this product in the selected period.',
  })
  views!: number;
  @ApiProperty({
    description:
      'Distinct account or anonymous visitor/session identities with a view in the selected period. Account and anonymous identities are not merged.',
  })
  uniqueViewers!: number;
  @ApiProperty({
    description:
      'Recorded cart-add events for this product in the selected period.',
  })
  cartAdds!: number;
  @ApiProperty({
    description:
      'Recorded wishlist-add events for this product in the selected period.',
  })
  wishlistAdds!: number;
  @ApiProperty({
    description:
      'Distinct non-cancelled paid orders containing this product in the selected period.',
  })
  paidOrders!: number;
  @ApiProperty({
    description:
      'Units of this product in qualifying paid orders created in the selected period.',
  })
  paidUnits!: number;
  @ApiProperty({
    description:
      'Gross paid product-line revenue in the selected period, before refunds.',
  })
  paidRevenue!: string;
  @ApiProperty({
    description:
      'Distinct cart/product/variant lines added in the selected period.',
  })
  cartLinesAdded!: number;
  @ApiProperty({
    description:
      'Added cart/product/variant lines matched to a non-cancelled paid order within seven days of the latest add.',
  })
  cartLinesPurchased!: number;
  @ApiProperty({
    description:
      'Percentage of cart lines added in the selected period that matched a paid order within seven days.',
  })
  cartToPurchaseRate!: number;
  @ApiProperty({
    description:
      'Distinct signed-in account/product pairs with a product view in the selected period. Anonymous views are excluded from this conversion cohort.',
  })
  identifiedViewers!: number;
  @ApiProperty({
    description:
      'Identified account/product view pairs followed by a cart add within seven days.',
  })
  viewersToCart!: number;
  @ApiProperty({
    description:
      'Identified account/product view pairs followed by a non-cancelled paid order within seven days.',
  })
  viewersToPurchase!: number;
  @ApiProperty({
    description:
      'Percentage of identified account/product view pairs followed by a cart add within seven days.',
  })
  productViewToCartRate!: number;
  @ApiProperty({
    description:
      'Percentage of identified account/product view pairs followed by a non-cancelled paid order within seven days.',
  })
  productViewToPurchaseRate!: number;
}

export class VendorProductPerformancePageDto {
  @ApiProperty({ type: [VendorProductPerformanceDto] })
  items!: VendorProductPerformanceDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
