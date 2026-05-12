import { describe, expect, it, vi } from 'vitest';
import { InitModule } from '../src/index';
import {
  PDH_RPC_ENSURE_MATCH,
  PDH_RPC_GET_REPLAY,
  PDH_RPC_TERMINATE_MATCH,
} from '../src/pdhMatch';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeInitializer() {
  return {
    registerAfterAuthenticateDevice: vi.fn(),
    registerMatch: vi.fn(),
    registerRpc: vi.fn(),
  };
}

describe('InitModule admin RPC registration', () => {
  it('does not register debug/admin RPCs by default', () => {
    const initializer = makeInitializer();

    InitModule({}, logger as any, {} as any, initializer as any);

    const registeredRpcIds = initializer.registerRpc.mock.calls.map((call) => call[0]);
    expect(registeredRpcIds).toContain(PDH_RPC_ENSURE_MATCH);
    expect(registeredRpcIds).not.toContain(PDH_RPC_GET_REPLAY);
    expect(registeredRpcIds).not.toContain(PDH_RPC_TERMINATE_MATCH);
  });

  it('registers debug/admin RPCs only when explicitly enabled', () => {
    const initializer = makeInitializer();

    InitModule(
      {
        env: {
          PDH_ENABLE_ADMIN_RPCS: 'true',
          PDH_ADMIN_USER_IDS: 'admin-user',
        },
      },
      logger as any,
      {} as any,
      initializer as any
    );

    const registeredRpcIds = initializer.registerRpc.mock.calls.map((call) => call[0]);
    expect(registeredRpcIds).toContain(PDH_RPC_GET_REPLAY);
    expect(registeredRpcIds).toContain(PDH_RPC_TERMINATE_MATCH);
  });
});
