import { adminApi, publicApi, userApi, vendorApi } from "@/api/core/client";
import type {
AdminAuthResponseDto,
AdminLoginPayload,
AdminSetupPayload,
AuthProfileDto,
AuthUserDto,
AuthResponseDto,
LoginPayload,
OtpRequestPayload,
RegisterPayload,
RegisterResponseDto,
ResetPasswordPayload,
VendorLoginPayload,
VendorOtpRequestPayload,
VendorRegisterPayload,
VerifyOtpResponseDto,
} from "@/api/dto/auth";

export const authService = {
  requestOtp(payload: OtpRequestPayload) {
    return publicApi.post<VerifyOtpResponseDto>("/auth/otp/request", payload);
  },
  requestRegistrationOtp(payload: OtpRequestPayload) {
    return publicApi.post<VerifyOtpResponseDto>("/auth/otp/request", payload);
  },
  verifyRegistrationOtp(payload: { email: string; otpCode: string }) {
    return publicApi.post<VerifyOtpResponseDto>("/auth/otp/verify", payload);
  },
  requestPasswordResetOtp(payload: { email: string }) {
    return publicApi.post<{ message: string }>("/auth/forgot-password/otp/request", payload);
  },
  register(payload: RegisterPayload) {
    return publicApi.post<RegisterResponseDto>("/auth/register", payload);
  },
  resetPassword(payload: ResetPasswordPayload) {
    const { otp, otpCode, ...rest } = payload;
    return publicApi.post<{ message: string }>("/auth/reset-password", {
      ...rest,
      otpCode: otpCode ?? otp,
    });
  },
  login(payload: LoginPayload) {
    return publicApi.post<AuthResponseDto>("/auth/login", payload);
  },
  me() {
    return userApi.get<AuthProfileDto>("/auth/me");
  },
  refresh() {
    return publicApi.post<AuthResponseDto>("/auth/refresh");
  },
  logout() {
    return userApi.post<void>("/auth/logout");
  },
  logoutAll() {
    return userApi.post<void>("/auth/logout-all");
  },
};

export const adminAuthService = {
  setup(payload: AdminSetupPayload) {
    return publicApi.post<AdminAuthResponseDto>("/admin/auth/setup", payload);
  },
  login(payload: AdminLoginPayload) {
    return publicApi.post<AdminAuthResponseDto>("/admin/auth/login", payload);
  },
  me() {
    return adminApi.get<AuthUserDto>("/admin/auth/me");
  },
  updateMe(payload: { firstName?: string; lastName?: string }) {
    return adminApi.patch<AdminAuthResponseDto>("/admin/auth/me", payload);
  },
  refresh() {
    return publicApi.post<AdminAuthResponseDto>("/admin/auth/refresh");
  },
  logout() {
    return adminApi.post<void>("/admin/auth/logout");
  },
};

export const vendorAuthService = {
  requestOtp(payload: VendorOtpRequestPayload) {
    return publicApi.post<VerifyOtpResponseDto>("/vendors/auth/otp/request", payload);
  },
  register(payload: VendorRegisterPayload) {
    return publicApi.post<RegisterResponseDto>("/vendors/auth/register", payload);
  },
  login(payload: VendorLoginPayload) {
    return publicApi.post<import("@/api/dto/vendor").VendorAuthSessionDto>(
      "/vendors/auth/login",
      payload
    );
  },
  me() {
    return vendorApi.get<import("@/api/dto/vendor").VendorResponseDto>("/vendors/me");
  },
  refresh() {
    return publicApi.post<import("@/api/dto/vendor").VendorAuthSessionDto>(
      "/vendors/auth/refresh"
    );
  },
  logout() {
    return vendorApi.post<void>("/vendors/auth/logout");
  },
};
