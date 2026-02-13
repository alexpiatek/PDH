import type * as nkruntime from '@heroiclabs/nakama-runtime';
import {
  DEFAULT_MATCH_MODULE,
  ensureDefaultMatchAfterAuthenticate,
  pdhMatchHandler,
} from './pdhMatch';
import {
  SMOKE_MATCH_MODULE,
  SMOKE_RPC_ENSURE_MATCH,
  rpcEnsureSmokeMatch,
  smokeMatchHandler,
} from './smokeMatch';

const InitModule: nkruntime.InitModule = (ctx, logger, nk, initializer) => {
  const maybeRegisterAfterAuthenticateDevice = (
    initializer as unknown as { registerAfterAuthenticateDevice?: (...args: any[]) => void }
  ).registerAfterAuthenticateDevice;

  if (typeof maybeRegisterAfterAuthenticateDevice === 'function') {
    maybeRegisterAfterAuthenticateDevice(ensureDefaultMatchAfterAuthenticate);
  } else {
    logger.warn('registerAfterAuthenticateDevice unavailable; default match auto-create disabled.');
  }

  initializer.registerMatch(DEFAULT_MATCH_MODULE, pdhMatchHandler);
  initializer.registerMatch(SMOKE_MATCH_MODULE, smokeMatchHandler);
  initializer.registerRpc(SMOKE_RPC_ENSURE_MATCH, rpcEnsureSmokeMatch);

  logger.info(
    'PDH Nakama module loaded (modules: %v, %v)',
    DEFAULT_MATCH_MODULE,
    SMOKE_MATCH_MODULE
  );
};

globalThis.InitModule = InitModule;
