export type OrderStatusType =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface CartItemDto {
  id: string;
  productId: string;
  variantId?: string | null;
  name: string;
  slug: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  storeName?: string | null;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  creatorId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productSnapshot?: Record<string, unknown> | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatusType;
  totalAmount: number;
  finalAmount: number;
  discountAmount?: number;
  shippingAddress?: string | null;
  createdAt: string;
  orderItems: OrderItemDto[];
}
