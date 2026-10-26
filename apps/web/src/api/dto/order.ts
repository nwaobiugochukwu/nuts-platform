import type { OrderStatus,PaymentStatus } from "../core/types";

// ── Orders ───────────────────────────────────────────────────────────────────

export interface CheckoutItemSnapshotDto {
  productName: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface CheckoutShippingAddressDto {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  country: string;
}

export interface CheckoutResponseDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  discountAmount: number;
  referralDiscountAmount: number;
  finalAmount: number;
  discountCode?: string | null;
  referralCode?: string | null;
  items: CheckoutItemSnapshotDto[];
  shippingAddress?: CheckoutShippingAddressDto | string | null;
  authorizationUrl?: string | null;
  paystackAccessCode?: string | null;
  paymentReference?: string | null;
  paymentStatus?: PaymentStatus;
}

export interface OrderProductSnapshotDto {
  name: string;
  sku: string;
  images: string[];
}

export interface OrderVariantSnapshotDto {
  options: { name: string; value: string }[];
}

export interface OrderItemResponseDto {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productSnapshot: OrderProductSnapshotDto;
  variantSnapshot?: OrderVariantSnapshotDto | null;
}

export interface OrderResponseDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  discountAmount: number;
  referralDiscountAmount: number;
  finalAmount: number;
  discountCode?: string | null;
  referralCode?: string | null;
  items: OrderItemResponseDto[];
  shippingAddress?: CheckoutShippingAddressDto | null;
  shippingAddressId?: string | null;
  paymentExpiresAt?: string | Date | null;
  createdAt: Date;
}

export interface OrderSummaryDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  finalAmount: number;
  createdAt: Date;
}

export interface OrderItemDetailDto {
  productId: string;
  variantId: string | null;
  productName: string;
  productSlug: string;
  variantName: string | null;
  quantity: number;
  price: number;
}

export interface OrderDetailsDto {
  orderNumber: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  status: OrderStatus;
  items: OrderItemDetailDto[];
  createdAt: Date;
}

export interface OrderCustomerDto {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface OrderVendorDto {
  id: string;
  storeName: string;
  storeSlug: string;
}

export interface OrderPaymentDto {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  transactionId?: string | null;
}

export interface AdminOrderItemResponseDto extends OrderItemResponseDto {
  productSku?: string;
}

export interface OrderStatusHistoryDto {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: Date;
  changedBy: OrderCustomerDto | null;
}

export interface AdminOrderResponseDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  discountAmount: number;
  referralDiscountAmount: number;
  finalAmount: number;
  discountCode?: string | null;
  referralCode?: string | null;
  platformFee: number;
  vendorRevenue: number;
  customer: OrderCustomerDto;
  vendor?: OrderVendorDto | null;
  payment?: OrderPaymentDto | null;
  shippingAddress?: string | null;
  stockRestored: boolean;
  items: AdminOrderItemResponseDto[];
  statusHistory: OrderStatusHistoryDto[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VendorOrderResponseDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  discountAmount: number;
  referralDiscountAmount: number;
  finalAmount: number;
  discountCode?: string | null;
  referralCode?: string | null;
  items: OrderItemResponseDto[];
  shippingAddress?: string | null;
  stockRestored: boolean;
  createdAt: Date;
  updatedAt: Date;
  customer: OrderCustomerDto;
  statusHistory: OrderStatusHistoryDto[];
}