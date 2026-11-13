import { userApi } from "@/api/core/client";
import type {
InitializePaymentResponseDto,
PaymentResponseDto,
} from "@/api/dto/payment";

export const paymentService = {
  initialize(orderId: string) {
    return userApi.post<InitializePaymentResponseDto>(
      "/payments/initialize",
      null,
      {
        params: { orderId },
      }
    );
  },
  getByOrderId(orderId: string) {
    return userApi.get<PaymentResponseDto>(`/payments/order/${orderId}`);
  },
  verify(reference: string) {
    return userApi.get<PaymentResponseDto>(
      `/payments/callback?reference=${encodeURIComponent(reference)}`
    );
  },
};
