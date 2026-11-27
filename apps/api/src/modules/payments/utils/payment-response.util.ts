import type { Prisma } from '@prisma/client';
import type { PaymentResponseDto } from '../dto/payment-response.dto';

export function toPaymentResponse(
  payment: Prisma.PaymentGetPayload<object>,
): PaymentResponseDto {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    transactionReference: payment.transactionReference,
    paymentLink: payment.paymentLink,
    paymentMethod: payment.paymentMethod,
    createdAt: payment.createdAt,
  };
}
