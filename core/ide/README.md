# Event Relation Engine (IDE-grade)

## Architecture

1. **Parser Layer** (`ImmutableAstParser`)
   - Produces immutable AST documents.
   - Uses stable ID factory for deterministic node/symbol IDs.
2. **Index Layer** (`IncrementalIndexer`)
   - Builds symbol graph + relation index.
   - Uses two-tier cache:
     - `Map<uri, IndexBundle>` for version-local reuse.
     - `WeakMap<AstDocument, IndexBundle>` for memoized object-identity fast path.
3. **Diagnostics Layer**
   - Emits missing handler, dangling refs, duplicate symbols.
4. **Quick Actions Layer**
   - Converts diagnostics into code actions.
5. **Refactor Layer** (`RenamePropagation`)
   - Creates workspace-wide rename transaction.
6. **Reactive Runtime** (`EventRelationEngine`)
   - Supports live sync with subscription model for renderer/UI.

## Dependency Graph

- `EventRelationEngine`
  - depends on `Parser`
  - depends on `IncrementalIndexer`
  - depends on `QuickActionsEngine`
- `IncrementalIndexer`
  - depends on `StableIdFactory`
- `QuickActionsEngine`
  - depends on `HandlerGenerator`
- `RenamePropagation`
  - depends on indexed bundle state

## Pipeline

`source update -> parse -> incremental index -> diagnostics -> code actions -> renderer snapshot -> UI subscribers`

## Performance Strategy

- **Immutable snapshots** enable undo/redo safety and deterministic diffing.
- **Stable IDs** ensure relation continuity across edits.
- **WeakMap memoization** avoids recompute for unchanged AST object references.
- **Incremental URI cache** allows partial recomputation on per-document changes.
- **O(N) linear node scan** in parser/indexer with constrained cross-link search.
- Ready for future shardable relation indexes and worker-thread partitioning.

## Plugin System (future)

Planned extension points:

- `ParserPlugin`: custom DSL grammars.
- `RelationPlugin`: custom relation edge inference.
- `DiagnosticPlugin`: domain-specific lint rules.
- `CodeActionPlugin`: custom quick fixes.
- `RendererPlugin`: graph overlays/minimap/timeline projections.

All plugins should consume immutable inputs and return immutable outputs,
allowing deterministic caching and safe multi-plugin composition.
