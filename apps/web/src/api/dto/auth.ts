// ── Auth (user) ─────────────────────────────────────────────────────────────

export interface AuthUserDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface UserCapabilities {
  canPurchase: boolean;
  canSell: boolean;
  canAdminister: boolean;
}

export interface AuthProfileDto {
  id: string;
  email: string;
  role: AuthRole;
  capabilities?: UserCapabilities;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phoneNumber?: string | null;
  storeName?: string;
  storeSlug?: string;
  storeLogoUrl?: string | null;
  isVerified?: boolean;
  isActive?: boolean;
}

export interface AuthResponseDto {
  user: AuthUserDto;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface AdminAuthResponseDto {
  admin: AuthUserDto;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface RegisterResponseDto {
  userId: string;
  email: string;
  requiresVerification: boolean;
}

export interface VerifyOtpResponseDto {
  verified: boolean;
}

export interface VendorLoginResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  storeName: string;
  storeSlug: string;
  storeLogo?: string | null;
  storeDescription: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  storeLogoUrl: string | null;
  storeLogoAltText: string | null;
  phone: string | null;
  isVerified: boolean;
  isActive: boolean;
  isApproved: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface OtpRequestPayload {
  email: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  referralCode?: string;
  otpCode?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ResetPasswordPayload {
  email: string;
  otpCode: string;
  otp?: string;
  newPassword: string;
}

export interface AdminSetupPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  setupKey?: string;
}

export interface AdminLoginPayload {
  email: string;
  password: string;
}

export interface VendorRegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string;
  businessPhone?: string;
  businessEmail?: string;
}

export interface VendorOtpRequestPayload {
  email: string;
}

export interface VendorLoginPayload {
  email: string;
  password: string;
}

/** Auth role — single source of truth used by interceptors and stores. */
export type AuthRole = "user" | "admin" | "vendor";

/** Payload for Google Sign-In via ID token (Google Identity Services). */
export interface GoogleAuthPayload {
  /** The ID token returned by Google Identity Services (credential). */
  idToken: string;
  /** Optional referral code applied when registering a new account. */
  referralCode?: string;
}

/** Payload for Vendor Google Sign-In via ID token. */
export interface VendorGoogleAuthPayload {
  idToken: string;
  storeName?: string;
  storeDescription?: string;
  businessPhone?: string;
  businessEmail?: string;
}
