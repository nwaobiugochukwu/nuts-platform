import { ROLE } from '@prisma/client';

export interface JwtUser {
  id: string;
  email: string;
  role: ROLE;
  /** Present on tokens issued with a per-device session. */
  sessionId?: string;
}
