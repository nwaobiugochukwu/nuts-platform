export type AuthRole = 'USER' | 'CREATOR' | 'ADMIN';

export type AuthStatus =
  | 'unknown'
  | 'hydrating'
  | 'authenticated'
  | 'unauthenticated';

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  firstName?: string | null;
  lastName?: string | null;
  storeName?: string | null;
  storeSlug?: string | null;
  avatarUrl?: string | null;
}

export interface AuthSessionTokens {
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AuthRole;
  sid: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  refreshId: string;
  role: AuthRole;
  iat?: number;
  exp?: number;
}
