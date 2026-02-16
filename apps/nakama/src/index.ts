import type * as nkruntime from '@heroiclabs/nakama-runtime';
import {
  DEFAULT_MATCH_MODULE,
  PDH_RPC_GET_REPLAY,
  PDH_RPC_ENSURE_MATCH,
  PDH_RPC_TERMINATE_MATCH,
  ensureDefaultMatchAfterAuthenticate,
  pdhMatchHandler,
  rpcGetPdhReplay,
  rpcEnsurePdhMatch,
  rpcTerminatePdhMatch,
} from './pdhMatch';
import {
  SMOKE_MATCH_MODULE,
  SMOKE_RPC_ENSURE_MATCH,
  rpcEnsureSmokeMatch,
  smokeMatchHandler,
} from './smokeMatch';
import {
  POKER_TABLE_MATCH_MODULE,
  RPC_CREATE_TABLE,
  RPC_JOIN_BY_CODE,
  pokerTableMatchHandler,
  rpcCreateTable,
  rpcJoinByCode,
} from './pokerLobby';

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
  initializer.registerRpc(PDH_RPC_ENSURE_MATCH, rpcEnsurePdhMatch);
  initializer.registerRpc(PDH_RPC_GET_REPLAY, rpcGetPdhReplay);
  initializer.registerRpc(PDH_RPC_TERMINATE_MATCH, rpcTerminatePdhMatch);
  initializer.registerMatch(SMOKE_MATCH_MODULE, smokeMatchHandler);
  initializer.registerRpc(SMOKE_RPC_ENSURE_MATCH, rpcEnsureSmokeMatch);
  initializer.registerMatch(POKER_TABLE_MATCH_MODULE, pokerTableMatchHandler);
  initializer.registerRpc(RPC_CREATE_TABLE, rpcCreateTable);
  initializer.registerRpc(RPC_JOIN_BY_CODE, rpcJoinByCode);

  logger.info(
    'PDH Nakama module loaded (modules: %v, %v, %v)',
    DEFAULT_MATCH_MODULE,
    SMOKE_MATCH_MODULE,
    POKER_TABLE_MATCH_MODULE
  );
};

globalThis.InitModule = InitModule;
