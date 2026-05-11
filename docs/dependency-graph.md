# Dependency Graph

Generated for the `cicada-tg==0.3.4` compatibility boundary.

```mermaid
flowchart TD
  Browser[Browser / React Studio] --> API[Studio Backend API]
  Browser --> DSL[DSL Panel / Visual Builder]
  DSL --> Codegen[core/dslCodegen.js]
  Codegen --> Lint[services/pythonDslLint.mjs]
  Lint --> VendorParser[vendor/cicada-dsl-parser/cicada]
  API --> PreviewClient[services/cicadaPreviewWorker.mjs]
  PreviewClient --> PreviewWorker[cicada.preview_worker]
  PreviewWorker --> Parser[cicada.parser]
  PreviewWorker --> Executor[cicada.executor]
  Executor --> Runtime[cicada.runtime]
  Executor --> CoreEvents[cicada.core events/effects]
  Executor --> DB[cicada.database]
  Executor --> MockAdapter[cicada.adapters.mock_telegram]
  Executor --> TelegramAdapter[cicada.adapters.telegram]
  CoreGuard[scripts/core-guard.mjs] --> InstalledCore[/installed cicada-tg 0.3.4/]
  CoreGuard --> LocalCore[cicada/ + core/ + vendor/]
```

Boundaries:

- `Browser`, `DSL`, and `Codegen` are Studio/editor responsibilities.
- `Parser`, `Executor`, `Runtime`, `CoreEvents`, `DB`, and adapters are canonical core responsibilities.
- `PreviewClient` is an adapter boundary, not a runtime override.
