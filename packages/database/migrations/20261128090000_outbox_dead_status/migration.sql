-- A row the relay has given up on gets its own status instead of staying FAILED forever,
-- so it can be alerted on and replayed. Kept in its own migration: Postgres does not let a
-- new enum value be used in the transaction that adds it.
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DEAD';
