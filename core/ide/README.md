# Production Event-Relation Compiler Frontend for Visual Bot IDE

## Compiler frontend design

- **Lexer**: token stream with positional metadata and trivia channels.
- **Recursive descent parser**: declaration/step grammar with explicit error recovery.
- **CST + AST split**: CST keeps recovery + token structure, AST keeps normalized semantics.
- **Parser diagnostics**: recoverable errors (`P001`, `P002`, `P999`) with ranges.
- **Incremental parsing**: dirty-range detection and dependency-edge patch basis.

## Core architecture

1. `parser.ts`
   - `Lexer`
   - `TokenStream`
   - `RecursiveDescentParser`
   - recovery nodes + parser diagnostics
   - dependency graph construction and dirty diffing
2. `semantic.ts`
   - semantic model build
   - transition graph patching
   - flow analysis
   - dead state analysis
   - recursive transition detection
   - infinite loop analysis
3. `indexing.ts`
   - persistent snapshot store
   - structural sharing via semantic reuse
   - partial semantic recompute hook with dirty set
4. `runtime.ts`
   - transaction engine
   - collaboration envelope (CRDT-friendly metadata)
   - worker registration for threaded index partitioning
   - LSP facade providers

## Lifecycle pipeline

`transaction -> parser -> CST -> AST -> dependency graph patch -> semantic recompute -> diagnostics -> persistent snapshot -> LSP/UI consumers`

## LSP integration

Implemented providers:
- semantic tokens
- hover
- references
- rename edits
- autocomplete

## Scalability plan

- Multiplayer editing: `CollaborationEnvelope` + vector clocks.
- CRDT synchronization: envelope design ready for CRDT op application layer.
- Worker-thread indexing: runtime worker registry and partitioning extension point.
- Million-node projects:
  - persistent snapshots
  - structural sharing
  - graph patching
  - partial semantic recompute
  - memory-local weak caches

## Suggestions Engine

- `engine/suggestions.ts` adds:
  - `collectButtons()`
  - `detectMissingButtonHandlers()`
  - `getSuggestions()`
- Suggestions are immutable, memoized, and stored in `WorkspaceSnapshot.suggestions`.
- Runtime `applySuggestion()` returns **AST mutation intents** (`create-handler-node`, `remove-handler-node`, `rename-button`, `delete-button`) so handler creation/removal is AST-driven instead of raw text editing.
- Info Panel can render menu-focused actions:
  - `⚡ События`
  - `➕ Добавить при нажатии 'Пункт 1'`
  - `➕ Добавить при нажатии 'Пункт 2'`
