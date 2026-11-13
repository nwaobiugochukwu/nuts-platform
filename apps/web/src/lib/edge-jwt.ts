/**
 * Edge Runtime JWT Verification via Web Crypto API (SubtleCrypto).
 *
 * Provides cryptographic HMAC-SHA256 signature verification in Next.js Edge Middleware
 * without external dependencies, preventing unverified token payload tampering or privilege escalation.
 */

export type Role = "admin" | "vendor" | "user";

export interface VerifiedJwtPayload {
  sub: string;
  role: Role;
  tokenVersion?: number;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string;
}

const keyCache = new Map<string, CryptoKey>();

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeRole(rawRole?: string | null): Role {
  const normalized = String(rawRole || "").toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "vendor") return "vendor";
  return "user";
}

/**
 * Cryptographically verifies an HS256-signed JWT token using Web Crypto API.
 *
 * @param token Raw JWT string (header.payload.signature)
 * @param secret Secret key string for HMAC-SHA256 verification
 * @returns VerifiedJwtPayload if valid and unexpired; null if tampered, expired, or invalid
 */
export async function verifyJwtHs256(
  token: string | null | undefined,
  secret: string | null | undefined,
  options?: { ignoreExpiration?: boolean },
): Promise<VerifiedJwtPayload | null> {
  if (!token || !secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return null;
  }

  try {
    // 1. Validate Header and Algorithm
    const headerBytes = base64UrlToUint8Array(headerB64);
    const headerJson = new TextDecoder().decode(headerBytes);
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string };

    if (header.alg !== "HS256") {
      return null;
    }

    // 2. Retrieve or Cache CryptoKey
    let key = keyCache.get(secret);
    if (!key) {
      const enc = new TextEncoder();
      key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keyCache.set(secret, key);
    }

    // 3. Verify Cryptographic Signature
    const sigBytes = base64UrlToUint8Array(signatureB64);
    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as BufferSource,
      signedData as unknown as BufferSource,
    );

    if (!isValid) {
      return null;
    }

    // 4. Parse Verified Claims
    const payloadBytes = base64UrlToUint8Array(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const rawPayload = JSON.parse(payloadJson) as {
      sub?: string;
      role?: string;
      tokenVersion?: number;
      exp?: number;
      iat?: number;
      iss?: string;
      aud?: string;
    };

    if (!rawPayload || typeof rawPayload !== "object") {
      return null;
    }

    // 5. Expiration Validation
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!options?.ignoreExpiration && typeof rawPayload.exp === "number" && rawPayload.exp <= nowSeconds) {
      return null;
    }

    return {
      sub: String(rawPayload.sub || ""),
      role: normalizeRole(rawPayload.role),
      tokenVersion:
        typeof rawPayload.tokenVersion === "number"
          ? rawPayload.tokenVersion
          : undefined,
      exp: rawPayload.exp,
      iat: rawPayload.iat,
      iss: rawPayload.iss,
      aud: rawPayload.aud,
    };
  } catch {
    return null;
  }
}

