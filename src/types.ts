import type { Env, SessionUser } from './env';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
    /** Jumlah pengajuan pending, dihitung sekali di loadUser untuk nav bendahara. */
    pendingCount: number;
  };
};
