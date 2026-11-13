CREATE TABLE "user_auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "refreshToken" TEXT,
    "refreshTokenId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_auth_sessions_refreshTokenId_key"
    ON "user_auth_sessions"("refreshTokenId");

CREATE INDEX "user_auth_sessions_userId_revokedAt_expiresAt_idx"
    ON "user_auth_sessions"("userId", "revokedAt", "expiresAt");

ALTER TABLE "user_auth_sessions"
    ADD CONSTRAINT "user_auth_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "user_auth_sessions" (
    "id",
    "userId",
    "tokenVersion",
    "refreshToken",
    "refreshTokenId",
    "expiresAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "tokenVersion",
    "refreshToken",
    "refreshTokenId",
    -- The signed refresh JWT remains the authoritative expiry.
    CURRENT_TIMESTAMP + INTERVAL '30 days',
    CURRENT_TIMESTAMP
FROM "users"
WHERE "refreshToken" IS NOT NULL
  AND "refreshTokenId" IS NOT NULL;
