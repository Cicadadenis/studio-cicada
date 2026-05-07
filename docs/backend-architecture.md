# Backend Refactor Plan

Current `server.mjs` is still a monolith, but the first extraction is done: DSL execution moved to `services/dslRunner.mjs`.

## Target Layers

- `controllers/` - HTTP input/output only (`req`, `res`, validation, status codes)
- `services/` - business rules, workflows, security policies
- `repositories/` - PostgreSQL queries only
- `domain/` - shared entities/value objects/constants

## Migration Order

1. Move bot runtime flows to `services` (completed for DSL runner).
2. Extract auth flows to `services/authService.mjs` and `repositories/userRepo.mjs`.
3. Extract admin flows to `controllers/adminController.mjs` + `services/adminService.mjs`.
4. Keep `server.mjs` as route wiring + middleware bootstrap only.

## Testing Strategy

- Unit tests for `services` (pure logic).
- Integration tests for `repositories` against test DB.
- API smoke tests for controllers.

## Security Notes

- DSL execution must stay isolated:
  - spawned without shell
  - bounded code size
  - hard timeout kill
  - bounded log buffer
- For stronger isolation, run DSL executor inside a dedicated container/runtime (next step).
