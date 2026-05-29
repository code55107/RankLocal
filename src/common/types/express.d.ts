import { AuthUser } from '@/auth/auth.types';

// Augment Express's Request so AuthGuard can attach the resolved principal
// and the @CurrentUser() decorator can read it with full typing.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
