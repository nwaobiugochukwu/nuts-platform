export type PaystackInitializePayload = {
  email: string;
  amount: number;
  currency?: string;
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
};

export type PaystackInitializeData = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackApiResponse<T> = {
  status: boolean;
  message: string;
  data: T;
};

export type PaystackVerifyData = {
  status: string;
  reference: string;
  id?: number;
  amount?: number;
  currency?: string;
  paid_at?: string;
};

export type PaystackWebhookEvent = {
  event: string;
  data?: {
    status?: string;
    reference?: string;
    id?: number;
    amount?: number | string;
    currency?: string;
    paid_at?: string;
    metadata?: Record<string, unknown>;
    refund_reference?: string | null;
    transaction_reference?: string;
  };
};
