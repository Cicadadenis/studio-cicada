# Core Compatibility Policy

`cicada-tg==0.3.3` is the canonical core for this project. The installed package in `/usr/local/lib/python3.12/dist-packages/cicada` is the source of truth for runtime behavior.

## Architecture Boundaries

- **CORE**: immutable runtime copied from `cicada-tg==0.3.3`. No Studio-specific behavior is allowed here.
- **STUDIO**: UI/editor, DSL drafting, visual blocks, hints, user flows, and presentation.
- **ADAPTERS**: integration layer between Studio and the canonical core/runtime.
- **LEGACY**: isolated obsolete compatibility notes or code. It must not be imported by CORE.

## Synchronized Directories

These directories are synchronized from the canonical package and guarded by hash/API checks:

- `cicada/`
- `core/*.py`, `core/adapters/*.py`, `core/core.py`
- `vendor/cicada-dsl-parser/cicada/`

The canonical source is configured by `CICADA_CANONICAL_CORE`; default:

```bash
/usr/local/lib/python3.12/dist-packages/cicada
```

## Hash Verification Policy

- `npm run core:guard` compares every canonical `.py` file against synchronized copies.
- Any missing file or hash mismatch fails the guard.
- The guard also checks `cicada-tg` package version and API surface signatures.
- `npm run build` runs `core:guard` before Vite build, so production builds fail on drift.

## Compatibility Matrix

| Area | Canonical Owner | Studio Role | Guard |
| --- | --- | --- | --- |
| DSL parser | `cicada.parser` | Generate valid DSL and show UX hints | parser parity + core guard |
| Runtime/executor | `cicada.executor`, `cicada.runtime` | Call runtime, display results | runtime parity + core guard |
| Events/effects | `cicada.core` | Normalize UI payloads to runtime requests | API surface + preview parity |
| Telegram adapters | `cicada.adapters.*` | Use through runtime/preview only | adapter compatibility |
| Preview | `cicada.preview_worker` | Send JSON requests, render outbound actions | preview parity |
| Legacy behavior | `legacy/` only | Documentation or migration notes | forbidden import scan |

## Legacy Layer Policy

- Legacy behavior must be marked with `@obsolete`.
- Legacy files live under `legacy/`.
- CORE directories must not import `legacy`.
- Legacy may document old Studio behavior, but it must not restore or override runtime semantics.

Current obsolete expectations:

- `db_template_key`: old Studio rendered `{chat_id}` inside quoted DB keys.
- `scenario_ask_resume_after_media`: old smoke tests expected media answers to resume remaining scenario statements differently.

## Forbidden Overrides

Do not:

- patch parser/executor/runtime behavior directly in synchronized CORE copies;
- add Studio-specific branches to `cicada/`, `core/*.py`, or vendored `cicada/`;
- shadow `cicada` imports with local monkey patches outside tests;
- import `legacy/` from runtime paths;
- change canonical behavior to satisfy UI expectations.

Use adapters/extensions instead:

- `services/*` for backend integration;
- `src/*` for editor/UI transforms;
- explicit adapter modules for boundary conversion.

## Upgrade Protocol

1. Install the new core version, for example `pip install cicada-tg==0.3.4`.
2. Update `EXPECTED_VERSION` in `scripts/core-guard.mjs` and docs.
3. Sync canonical files from installed `cicada/` into synchronized directories.
4. Run `npm run core:guard`.
5. Run `npm run ci:compat`.
6. Update DSL snapshots/feature matrix only when the new core accepts/rejects syntax differently.
7. Move incompatible Studio assumptions to `legacy/` with `@obsolete`.
8. Never edit the installed package or synchronized CORE copies manually to make tests pass.

## Required Commands

```bash
npm run core:guard
npm run ci:compat
npm run build
```
