# Migration Architecture: `studio-cicada` → `cicada-tg==0.3.4`

> Scope note: current alignment target is the installed `cicada-tg==0.3.4` package from `/usr/local/lib/python3.12/dist-packages`.

## 1) Architecture comparison

### A. Current `studio-cicada` (as found)
- Contains UI/editor and DSL tooling (`src/*`, `core/dslCodegen.js`, parser, schema validators).
- Also contains local runtime/execution orchestration in backend services:
  - process-spawn runner and lifecycle (`services/dslRunner.mjs`)
  - Python runtime/executor modules (`core/executor.py`, `core/runtime.py`, mirrored in `cicada/*`)
  - local adapters for Telegram/mock (`core/adapters/*`, `cicada/adapters/*`)
- This means current system is **hybrid** (builder + runtime), not thin-client.

### B. Target model (`cicada-tg==0.3.4` as source of truth)
- Runtime ownership must move 100% to package/runtime service:
  - AST schema validation
  - DSL→AST compile
  - AST execution
  - memory/state
  - media/file operations
  - event handling and Telegram adapter
- `studio-cicada` becomes:
  - DSL/AST authoring UI
  - validation UX (non-authoritative hints)
  - API client to runtime
  - execution result visualization only

## 2) Conflict table (cicada-tg wins)

| Area | What exists in `studio-cicada` now | Conflict | Decision (winner) | Migration action |
|---|---|---|---|---|
| DSL parsing/compile | Local parser + codegen (`src/ccdParser.js`, `core/parser/*`, `core/dslCodegen.js`) | Potential grammar drift with runtime package | `cicada-tg` compiler/AST rules | Keep local parser only for UX drafting; authoritative compile on runtime API |
| AST schema | Local schemas (`core/schemas/ast.schema.json`) | Version mismatch risk | `cicada-tg` AST schema | Runtime validates; studio consumes schema version metadata |
| Execution pipeline | Local process runner (`services/dslRunner.mjs`) | Duplicated execution path | `cicada-tg` execute path | Remove/disable local spawn execution; replace with HTTP/gRPC call |
| Runtime state/memory | Local `Runtime/UserContext` (`core/runtime.py`, `cicada/runtime.py`) | Diverging memory semantics | `cicada-tg` memory model | Studio no longer stores execution state except UI session |
| Telegram adapter | Local adapters in repo | Duplicate transport behavior | `cicada-tg` adapter layer | Studio sends events/request payloads to runtime; no direct Telegram logic |
| File/media handling | DSL has media nodes + local execution support (`send_file`, document/photo handlers) | Storage path and lifecycle mismatch | `cicada-tg` file/media subsystem | Use runtime media endpoints and file IDs/URLs only |
| Event model | UI parser supports callbacks, media triggers, scenarios | Event normalization can diverge | `cicada-tg` event contract | Adopt runtime event envelope contract verbatim |
| Error model | Mixed local exceptions/log output | Inconsistent diagnostics | `cicada-tg` error taxonomy | Standardize error response contract (code/message/context) |

## 3) API mapping table (`studio-cicada` → runtime)

> Function names below are integration targets; confirm exact names/signatures in `cicada-tg==0.3.4` docs.

| Studio action | Current local mechanism | Target `cicada-tg` API call | Request payload | Response |
|---|---|---|---|---|
| Validate DSL | local lint/parse | `compile(dsl)` or `POST /compile` | `{dsl, schema_version?}` | `{ast, diagnostics}` |
| Build AST from editor graph | local `dslCodegen` + parser | `compile(dsl)` (authoritative) | generated DSL text | canonical AST |
| Dry-run/execute AST | local spawned process | `execute_ast(ast, event, context)` or `POST /execute` | `{ast,event,session}` | `{actions,state_delta,logs}` |
| Trigger start/message/callback event | local event handling | `dispatch_event(event)` | normalized event envelope | execution result |
| Send message from flow | local adapter call path | runtime internal action (`send_message`) | produced by executor | action receipts/errors |
| Send document/media | local executor media nodes | runtime internal action (`send_document`, etc.) | file ref / upload token | delivery status |
| Memory set/get in flow | local `Runtime` vars/db | `runtime.memory.set/get` | `{scope,key,value}` | `{ok,value}` |
| Scenario step transition | local `ctx.scenario/step` | runtime scenario manager | `{chat_id,event}` | updated state |
| Persist/retrieve files | local FS paths | runtime file API | `{file_id|url|blob_ref}` | canonical `media_ref` |

## 4) Migration steps

1. **Freeze runtime features in studio**
   - Mark local executor/runner as deprecated feature-flag path.
2. **Define runtime integration contract**
   - OpenAPI/JSON schema for `/compile`, `/execute`, `/memory`, `/media`, `/health`.
3. **Implement `RuntimeClient` in studio backend**
   - Central module with retries, timeout, auth headers, idempotency key.
4. **Switch execution endpoints**
   - Replace `services/dslRunner.mjs` usage with `RuntimeClient.execute*`.
5. **Canonical compile path**
   - UI can keep local fast lint; final compile must call runtime.
6. **Unify error handling**
   - Map runtime error codes to UI diagnostics panel; keep raw context for debug mode.
7. **Media/file integration**
   - Upload/download through runtime endpoints only; no local bot file lifecycle.
8. **State & memory cutover**
   - Remove/disable local runtime state reliance; keep only UI metadata locally.
9. **Contract tests**
   - Golden tests: DSL input -> runtime AST -> execution actions; compare snapshots.
10. **Delete duplicate runtime code paths**
   - Remove old runner and execution wiring after parity acceptance.

## 5) Final architecture diagram (text)

```text
[React UI / DSL Editor / Visual Builder]
                |
                | (DSL text / graph draft)
                v
     [Studio Backend API Gateway]
                |
                | 1) POST /compile {dsl}
                | 2) POST /execute {ast,event,session}
                | 3) POST /memory/*
                | 4) POST /media/*
                v
      [cicada-tg Runtime Service 0.3.4]
      ├─ AST validator + compiler
      ├─ Execution engine
      ├─ Runtime state + memory
      ├─ Scheduler/scenario manager
      ├─ File/media subsystem
      └─ Telegram adapter
                |
                v
         [Telegram Bot API]
```

## Integration strategy details

- `studio-cicada` should call runtime through a single backend integration boundary (never directly from browser for secrets/security).
- AST transfer format: JSON, include `schema_version`, `compiler_version`, `trace_id`.
- Result format should include:
  - `actions[]` (message/document/etc.)
  - `state_delta`
  - `next_waiting_for`
  - `diagnostics[]`
  - `runtime_meta` (latency/version).
- Error handling:
  - 4xx: DSL/AST/event validation errors (show user-fix hints)
  - 5xx: runtime/system errors (retry policy + incident logging)
  - deterministic error codes required for UI mapping.

## What must be removed or simplified in studio

- Local execution runner orchestration (`services/dslRunner.mjs`).
- Any backend route that spawns local cicada runtime process for execution.
- Local runtime authority (state, scenario, media lifecycle) as source of truth.
- Keep only:
  - editor parsing/preview aids
  - UX linting
  - runtime API client + presentation layer.
