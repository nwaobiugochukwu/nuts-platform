import { ROLE } from '@prisma/client';

export interface JwtUser {
  id: string;
  email: string;
  role: ROLE;
}
