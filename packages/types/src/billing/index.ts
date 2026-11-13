export type PaymentStatusType =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUNDED';

export type WalletTransactionType = 'CREDIT' | 'DEBIT';

export type WalletTransactionReason =
  | 'SALE'
  | 'REFUND'
  | 'WITHDRAWAL'
  | 'DEPOSIT'
  | 'COMMISSION'
  | 'REFERRAL'
  | 'ADJUSTMENT';

export interface UserWalletDto {
  id: string;
  userId: string;
  balance: number;
}

export interface CreatorWalletDto {
  id: string;
  creatorId: string;
  balance: number;
  pendingBalance: number;
  lifetimeEarnings: number;
}

export interface WalletTransactionDto {
  id: string;
  amount: number;
  type: WalletTransactionType;
  reason: WalletTransactionReason;
  referenceId?: string | null;
  createdAt: string;
}
