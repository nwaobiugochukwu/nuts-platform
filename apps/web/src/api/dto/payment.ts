import type { PaymentStatus } from "../core/types";

// ── Payments ─────────────────────────────────────────────────────────────────

export interface PaymentResponseDto {
  id: string;
  amount: number;
  status: PaymentStatus;
  currency: string;
  transactionReference: string | null;
  paymentLink: string | null;
  paymentMethod: string | null;
  orderId: string;
  createdAt: Date;
}

export interface InitializePaymentResponseDto {
  authorizationUrl: string;
  authorization_url?: string;
  accessCode?: string;
  reference: string;
  paymentId: string;
}