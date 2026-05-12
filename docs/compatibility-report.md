# Compatibility Report

Target: `cicada-tg==0.3.5`

## Current Status

- CORE hash/signature policy: enforced by `npm run core:guard`.
- Build guard: `npm run build` runs `core:guard` before Vite.
- Compatibility CI: `npm run ci:compat`.
- Synchronized runtime directories match installed canonical core:
  - `cicada/`
  - `core/`
  - `vendor/cicada-dsl-parser/cicada/`

## Architecture Violations Found

- Local Python runtime copies had drifted from installed `cicada-tg==0.3.5`.
- Studio tests encoded runtime behavior that the canonical core does not own.
- Preview was previously configured as if a checkout path was mandatory instead of using the installed package.
- Documentation referenced older core versions (`0.1.8`, `0.2.7`).

## Actions Taken

- Synced Python runtime copies to canonical `cicada-tg==0.3.5`.
- Added `scripts/core-guard.mjs` for hash, version, API surface, and forbidden legacy import checks.
- Added `scripts/compatibility-ci.mjs` for parser, runtime, DSL snapshot, preview, and adapter compatibility.
- Added `.cursor/rules/core-compatibility.mdc` as persistent project AI policy.
- Added `CORE_COMPATIBILITY.md` with boundaries, matrix, legacy policy, forbidden overrides, and upgrade protocol.
- Added generated architecture artifacts:
  - `docs/dependency-graph.md`
  - `docs/runtime-graph.md`
  - `docs/dsl-feature-matrix.md`
  - `docs/compatibility-report.md`
- Moved obsolete runtime expectations into `legacy/`.

## Risky Zones

- `src/App.jsx`: large UI file with local DSL parsing helpers. Risk: UI can drift from core grammar.
- `core/dslCodegen.js`: Studio DSL emitter. Risk: generated DSL must remain accepted by canonical parser.
- `services/pythonDslLint.mjs`: validation boundary. Risk: importing the wrong parser path would hide drift.
- `services/cicadaPreviewWorker.mjs`: runtime adapter boundary. Risk: must call core preview worker without semantic overrides.
- `vendor/cicada-dsl-parser/`: synchronized copy. Risk: easy to patch locally unless guard is run.

## Forbidden Overrides

- No direct runtime changes in synchronized CORE directories.
- No imports from `legacy/` into CORE.
- No monkey patches of `cicada.parser`, `cicada.executor`, `cicada.runtime`, or adapters outside tests.
- No Studio-specific runtime semantics in parser/executor/database/event handling.

## Maintainability

Rating: **B+**

Why not A yet:

- `src/App.jsx` is still very large and contains editor parsing logic.
- Studio keeps synchronized core copies for packaging/testing, so guard discipline is mandatory.
- Some compatibility wrappers still reference vendor paths for lint/hints.

## Upgrade Readiness for 0.3.5+

Rating: **High, guarded**

Upgrade steps are mechanical:

1. Install `cicada-tg==0.3.5`.
2. Update `EXPECTED_VERSION` in `scripts/core-guard.mjs`.
3. Sync canonical files into synchronized dirs.
4. Run `npm run ci:compat`.
5. Move any changed expectations to `legacy/` or adapters.

Expected readiness: **85%** for minor core upgrades, assuming upstream preserves public parser/executor contracts.
