import { ROLE } from '@prisma/client';

export type JwtPayload = {
  /**
   * Subject = the authenticated account ID.
   *
   * This is the only identifier we need to locate the account.
   */
  sub: string;

  /**
   * Signed authorization context.
   *
   * The server still checks the database account role before accepting
   * the session; this value is never taken from a request header/body.
   */
  role: ROLE;

  /**
   * Global account-session version.
   *
   * Incrementing this value invalidates previously issued access tokens.
   */
  tokenVersion: number;

  /**
   * Device-scoped session identifier. Required for user sessions issued
   * after migration; omitted by the separate admin/vendor auth flows.
   */
  sessionId?: string;
};
