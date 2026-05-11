# Visual Bot IDE Event-Relation Engine (Production Blueprint)

## Folder structure

- `core/ide/engine/types.ts` — contracts (AST, semantic model, diagnostics, actions, snapshots)
- `core/ide/engine/parser.ts` — lexer/parser/AST factory/stable IDs/snapshots
- `core/ide/engine/semantic.ts` — binder/symbol table/scope+reference resolver/relation graph/semantic diagnostics
- `core/ide/engine/indexing.ts` — incremental index with WeakMap memoization and cache invalidation boundaries
- `core/ide/engine/actions.ts` — quick actions + rename propagation/extract flow
- `core/ide/engine/runtime.ts` — reactive workspace runtime/event bus/undo-redo/plugin host

## Dependency graph

`types -> parser -> semantic -> indexing -> actions -> runtime`

Plugins wrap runtime stages:
`parser plugins -> semantic analyzers -> diagnostics plugins -> code action plugins -> renderer plugins`

## Lifecycle pipeline

1. Source update enters runtime transaction.
2. Parser plugins preprocess DSL.
3. Lexer + parser build immutable AST snapshot.
4. Binder builds symbol graph, scopes, references, relations.
5. Incremental index reuses previous snapshot via WeakMap/object identity.
6. Diagnostics detect missing/duplicate/dangling/orphan/unreachable/cyclic/invalid issues.
7. Quick actions generated.
8. Renderer plugins consume semantic snapshot.
9. Snapshot published to event bus + Info Panel subscribers.
10. History transaction persisted for undo/redo.

## AST example

```txt
event start
handler start goto help | reply Hello
event help
handler help reply How can I help?
```

## Semantic model example

- symbols: `event:start`, `event:help`, `handler:on_start`, `handler:on_help`
- references: `on_start -> event:start`
- relations:
  - `on_start handles start`
  - `on_start transition help`

## Diagnostics example

- `missing-handlers`
- `duplicate-handlers`
- `dangling-references`
- `orphan-handlers`
- `unreachable-flows`
- `cyclic-navigation`
- `invalid-transitions`

## Performance strategy

- Immutable AST snapshots + structural sharing.
- Stable deterministic IDs enable fine-grained graph patching.
- WeakMap memoization avoids full recompute for unchanged AST nodes.
- URI-index cache + partial subtree reindex scaffolding.
- Lazy semantic analysis extension point via `semanticAnalyzers` plugins.

## Info Panel integration contract

UI reads from `WorkspaceSnapshot`:
- `diagnostics`
- `codeActions`
- `semantic.references`
- `navigationTargets`

## Future scaling roadmap

- Worker-pool semantic partitions by module boundary.
- Persistent on-disk index and bloom filters for symbol lookup.
- Cross-file relation graph federation.
- Plugin sandboxing and capability-based execution.
