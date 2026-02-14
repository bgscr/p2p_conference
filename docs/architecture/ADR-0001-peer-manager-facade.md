# ADR-0001: Typed Peer Manager Facade

## Status
Accepted

## Context
- `SimplePeerManager` contains broad signaling/media/control responsibilities.
- Renderer code (`App.tsx`, hooks, views) relied on ad-hoc method access and optional calls.
- We need incremental decomposition without breaking runtime behavior.

## Decision
- Introduce `src/renderer/signaling/PeerManagerFacade.ts` as the typed contract boundary.
- Keep `SimplePeerManager` as the execution engine for this release.
- Route renderer integrations through the facade export from `src/renderer/signaling/index.ts`.
- Keep legacy methods during migration and expose a typed event map + `on(...)` API.

## Consequences
- Immediate type-safety improvement in renderer call sites.
- Lower-risk path to split signaling/media/reconnect services behind the facade later.
- Backward compatibility maintained by delegating existing methods to `SimplePeerManager`.
