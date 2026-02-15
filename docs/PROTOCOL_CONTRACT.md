# Protocol Contract and Versioning

Shared realtime payload contracts live in `packages/protocol`.

## Source of Truth

- Package: `@pdh/protocol`
- Version constant: `PDH_PROTOCOL_VERSION`
- Opcode mapping: `MatchOpCode`
- Runtime validators: `parseClientMessagePayload`, `parseServerMessagePayload` (Zod)

## Versioning Rules

- Additive changes can remain on current protocol version.
- Breaking payload changes must increment protocol version and maintain compatibility path where needed.
- Clients should send `v` on outgoing messages using `withProtocolVersion(...)`.
- Server treats missing `v` as v1 for backward compatibility.

## Change Workflow

1. Update schema/types in `packages/protocol/src/index.ts`.
2. Update Nakama/web/server call sites.
3. Add tests for new payload behavior and validation failure paths.
4. Document behavior changes in `CHANGELOG.md` and relevant docs.

## Safety Properties

- Client payloads are parsed and validated server-side before mutation.
- Unsupported message versions are rejected.
- Invalid payloads are treated as non-mutating errors.
