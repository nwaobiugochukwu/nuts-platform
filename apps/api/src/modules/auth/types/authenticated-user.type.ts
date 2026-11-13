import { ROLE } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: ROLE;
  firstName: string | null;
  lastName: string | null;
  sessionId?: string;
};
