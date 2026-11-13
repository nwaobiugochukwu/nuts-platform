import { ROLE } from '@prisma/client';

export type RefreshJwtPayload = {
  /**
   * Account ID represented by the refresh session.
   */
  sub: string;

  /**
   * Signed role context.
   */
  role: ROLE;

  /**
   * Random opaque identifier for the current refresh token.
   *
   * Only its hash is stored as the refresh secret in the database.
   */
  refreshId: string;

  /**
   * Stable device session identifier. Optional only for legacy refresh
   * tokens migrated from the previous single-session account fields.
   */
  sessionId?: string;
};
