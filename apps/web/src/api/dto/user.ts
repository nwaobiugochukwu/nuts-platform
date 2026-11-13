import type { WalletTransactionResponseDto } from "./vendor";

// ── Users ────────────────────────────────────────────────────────────────────

export interface ShippingInformation {
  id: string;
  fullName: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  country: string;
  isDefault: boolean;
}

export interface UserResponseDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneNumber: string | null;
  isEmailVerified?: boolean;
  isVerified: boolean;
  createdAt: Date;
  shippingInformation?: ShippingInformation | null;
  referralCode?: string | null;
}

export interface AdminUserResponseDto extends UserResponseDto {
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivationReason: string | null;
  scheduledPermanentDeleteAt: Date | null;
  updatedAt: Date;
}

export interface UserWalletResponseDto {
  id: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
  transactions: WalletTransactionResponseDto[];
}
