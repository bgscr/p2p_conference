# Refactor Safety Checklist

- Keep `npm run test`, `npm run test:e2e:smoke`, and `npm run build` green per PR.
- Run `npm run metrics:baseline` after major architecture/performance changes.
- Enforce regression checks with `npm run metrics:check` in CI.
- Do not introduce hardcoded TURN/MQTT secrets in renderer or main process.
- Validate production credential posture before release (`P2P_CREDENTIALS_URL` or secure env credentials).
- Confirm diagnostics bundles redact sensitive keys (`password`, `token`, `secret`, `credential`, `authorization`).
- Ensure new renderer orchestration code uses typed `PeerManager` contract, not `any`.
