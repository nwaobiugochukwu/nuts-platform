UPDATE "notifications"
SET "type" = 'PAYMENT_FAILED'
WHERE "type" = 'PAYMENT_RECEIVED'
  AND "title" = 'Payment Failed';
