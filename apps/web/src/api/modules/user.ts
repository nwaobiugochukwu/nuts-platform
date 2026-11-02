import { adminApi, userApi } from "@/api/core/client";
import type {
AdminUserResponseDto,
UserResponseDto,
UserWalletResponseDto,
} from "@/api/dto/user";
import type { WalletTransactionResponseDto } from "@/api/dto/vendor";
import type { ProductQueryParams } from "./product";

export interface UpdateUserProfilePayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneNumber?: string;
  email?: string;
}

export interface ShippingPayload {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  country: string;
  isDefault?: boolean;
}

export const userService = {
  me() {
    return userApi.get<UserResponseDto>("/account");
  },
  updateProfile(payload: UpdateUserProfilePayload) {
    const { phoneNumber, phone, ...rest } = payload;
    const effectivePhone = phone ?? phoneNumber;
    return userApi.patch<UserResponseDto>("/account", {
      ...rest,
      ...(effectivePhone !== undefined ? { phone: effectivePhone } : {}),
    });
  },
  updateShipping(payload: ShippingPayload) {
    return userApi.patch<UserResponseDto>("/account", {
      shippingInformation: payload,
    });
  },
  changePassword(payload: { currentPassword: string; newPassword: string }) {
    return userApi.patch<null>("/account/password", payload);
  },
  requestDeactivateOtp() {
    return userApi.post<{ message: string }>("/account/otp/request");
  },
  deactivate(otpCode: string) {
    return userApi.patch<{ message: string }>("/account/deactivate", {}, {
      headers: { "x-otp-code": otpCode },
    });
  },
  reactivate(payload: { email: string; password: string }) {
    return userApi.post<UserResponseDto>("/account/reactivate", payload);
  },
  deleteAccount() {
    return userApi.delete<null>("/account/delete");
  },
};

export const adminUserService = {
  requestOtp() {
    return adminApi.post<{ message: string }>("/admin/users/request-otp");
  },
  list(params: ProductQueryParams & { search?: string; status?: string }) {
    return adminApi.get<AdminUserResponseDto[]>("/admin/users", { params });
  },
  unsuspend(id: string, otpCode: string) {
    return adminApi.patch<{ success: boolean }>(`/admin/users/${id}/unsuspend`, {}, {
      headers: { "x-otp-code": otpCode },
    });
  },
  reactivate(id: string, otpCode: string) {
    return this.unsuspend(id, otpCode);
  },
  suspend(
    id: string,
    payload: { reason: string; duration?: string; suspendedUntil?: string },
    otpCode: string,
  ) {
    return adminApi.patch<{ success: boolean; message: string }>(
      `/admin/users/${id}/suspend`,
      payload,
      {
        headers: { "x-otp-code": otpCode },
      },
    );
  },
  deactivate(
    id: string,
    payload: { reason: string; duration?: string; suspendedUntil?: string },
    otpCode: string,
  ) {
    return this.suspend(id, payload, otpCode);
  },
  delete(id: string, otpCode: string) {
    return adminApi.delete<void>(`/admin/users/${id}`, {
      headers: { "x-otp-code": otpCode },
    });
  },
};

export const walletService = {
  getUserWallet() {
    return userApi.get<UserWalletResponseDto>("/account/wallet");
  },
  getUserTransactions(params?: { page?: number; limit?: number }) {
    return userApi.get<{
      data: WalletTransactionResponseDto[];
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>("/account/wallet/transactions", { params });
  },
};
