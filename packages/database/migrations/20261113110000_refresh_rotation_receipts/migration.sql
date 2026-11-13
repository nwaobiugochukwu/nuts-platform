CREATE TABLE "refresh_rotation_receipts" (
  "id" TEXT NOT NULL,
  "role" "ROLE" NOT NULL,
  "subject_id" TEXT NOT NULL,
  "session_id" TEXT,
  "previous_refresh_id_hash" TEXT NOT NULL,
  "encrypted_response" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_rotation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_rotation_receipts_replay_key"
  ON "refresh_rotation_receipts"("role", "subject_id", "previous_refresh_id_hash");

CREATE INDEX "refresh_rotation_receipts_expires_at_idx"
  ON "refresh_rotation_receipts"("expires_at");
