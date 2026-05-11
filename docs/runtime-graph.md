# Runtime Graph

Canonical runtime flow for `cicada-tg==0.3.3`.

```mermaid
sequenceDiagram
  participant UI as Studio UI
  participant API as Studio Backend
  participant Worker as cicada.preview_worker
  participant Parser as cicada.parser
  participant Executor as cicada.executor
  participant Runtime as cicada.runtime
  participant Adapter as Telegram/Mock Adapter

  UI->>API: DSL + event JSON
  API->>Worker: newline-delimited preview request
  Worker->>Parser: Parser(code).parse()
  Parser-->>Worker: Program AST
  Worker->>Executor: Executor(program, adapter)
  Worker->>Executor: handle(update)
  Executor->>Runtime: load/update user context
  Executor->>Adapter: emit messages/media/buttons
  Adapter-->>Executor: delivery result/effects
  Executor-->>Worker: CoreEffect[]
  Worker-->>API: { ok, outbound, effects }
  API-->>UI: renderable preview response
```

Runtime ownership:

- Event normalization, parser semantics, scenario state, executor dispatch, effects, and adapter contracts are core-owned.
- Studio may only send input and render output.
- Any behavior outside this path belongs in adapters/extensions, not in CORE.
