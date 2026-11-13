import { adminApi, userApi, vendorApi } from "@/api/core/client";
import type {
AdminOrderResponseDto,
CheckoutResponseDto,
OrderResponseDto,
OrderSummaryDto,
VendorOrderResponseDto,
} from "@/api/dto/order";

export interface CheckoutPayload {
  shippingAddress?: {
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    country?: string;
  };
  discountCode?: string;
  addressId?: string;
}

export const orderService = {
  checkout(payload: CheckoutPayload, idempotencyKey?: string) {
    const key = idempotencyKey || (typeof crypto !== "undefined" ? crypto.randomUUID() : `order-${Date.now()}`);
    return userApi.post<CheckoutResponseDto>("/orders/checkout", payload, {
      headers: { "idempotency-key": key },
    });
  },
  list(params?: { page?: number; limit?: number; status?: string }) {
    return userApi.get<OrderSummaryDto[]>("/orders", { params });
  },
  getById(id: string) {
    return userApi.get<OrderResponseDto>(`/orders/${id}`);
  },
  cancel(id: string) {
    return userApi.post<OrderResponseDto>(`/orders/${id}/cancel`);
  },
  updateShipping(id: string, shippingAddress: string) {
    return userApi.patch<OrderResponseDto>(`/orders/${id}/shipping`, { shippingAddress });
  },
};

export const adminOrderService = {
  list(params?: { page?: number; limit?: number; search?: string; status?: string }) {
    return adminApi.get<AdminOrderResponseDto[]>("/admin/orders", { params });
  },
  getById(id: string) {
    return adminApi.get<AdminOrderResponseDto>(`/admin/orders/${id}`);
  },
  updateStatus(id: string, payload: { status: string; note?: string }) {
    return adminApi.patch<AdminOrderResponseDto>(`/admin/orders/${id}/status`, payload);
  },
};

export const dashboardOrderService = {
  list(params?: { page?: number; limit?: number; search?: string; status?: string }) {
    return vendorApi.get<VendorOrderResponseDto[]>("/vendors/orders", { params });
  },
  getById(id: string) {
    return vendorApi.get<VendorOrderResponseDto>(`/vendors/orders/${id}`);
  },
  updateStatus(id: string, payload: { status: string; note?: string }) {
    return vendorApi.patch<VendorOrderResponseDto>(`/vendors/orders/${id}/status`, payload);
  },
};