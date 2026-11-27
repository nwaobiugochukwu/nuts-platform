export interface OrderProcessingPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  totalAmount: number;
  finalAmount: number;
  currency: string;
  vendorIds: string[];
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantOptions?: { name: string; value: string }[];
  }[];
  shippingAddress: string;
}

export interface OrderShippedPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  vendorEmails: { vendorId: string; email: string; storeName: string }[];
  trackingNumber?: string;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantOptions?: { name: string; value: string }[];
  }[];
}

export interface OrderDeliveredPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantOptions?: { name: string; value: string }[];
  }[];
}

export interface OrderCancelledPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  reason?: string;
  refundProcessed: boolean;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantOptions?: { name: string; value: string }[];
  }[];
}

export interface PaymentConfirmedPayload {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  amount: number;
  currency: string;
  paymentReference: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  userFirstName: string | null;
  reason?: string;
}

export interface ReferralRewardCreditedPayload {
  referralId: string;
  referrerId: string;
  referrerEmail: string;
  referredUserId: string;
  referrerName: string;
  rewardAmount: number;
}

export interface LowStockDetectedPayload {
  productId: string;
  productName: string;
  vendorId: string;
  vendorEmail: string;
  vendorStoreName: string;
  currentStock: number;
  variantId?: string;
  variantName?: string;
}

export interface NewOrderForVendorPayload {
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorEmail: string;
  vendorStoreName: string;
  customerName: string;
  items: {
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    variantOptions?: { name: string; value: string }[];
  }[];
  totalAmount: number;
  currency: string;
}

export interface VendorPaymentConfirmedPayload {
  vendorId: string;
  vendorEmail: string;
  vendorStoreName: string;
  amount: number;
  currency: string;
  transactionReference: string;
}

export interface VendorWeeklySummaryPayload {
  vendorId: string;
  vendorEmail: string;
  vendorStoreName: string;
  ordersCount: number;
  revenue: number;
  pendingBalance: number;
  settledBalance: number;
  bestSellingProducts: { name: string; quantity: number; revenue: number }[];
  weekStart: string;
  weekEnd: string;
}
