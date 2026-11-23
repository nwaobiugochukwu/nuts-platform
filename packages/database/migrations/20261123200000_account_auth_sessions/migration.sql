-- Per-device sessions for ADMIN and VENDOR accounts.
-- Purely additive. Tokens issued before this migration carry no sessionId and keep
-- using the legacy single refresh pointer on the account row until they expire, so
-- nobody is signed out by the deploy.

-- CreateTable
CREATE TABLE "account_auth_sessions" (
    "id" TEXT NOT NULL,
    "role" "ROLE" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "refreshToken" TEXT,
    "refreshTokenId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_auth_sessions_refreshTokenId_key" ON "account_auth_sessions"("refreshTokenId");

-- CreateIndex
CREATE INDEX "account_auth_sessions_role_subjectId_revokedAt_expiresAt_idx" ON "account_auth_sessions"("role", "subjectId", "revokedAt", "expiresAt");
