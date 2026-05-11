# Legacy Compatibility Layer

`legacy/` contains obsolete Studio compatibility behavior that is intentionally not part of canonical `cicada-tg==0.3.3`.

Rules:

- Every legacy entry must be marked `@obsolete`.
- Legacy code is documentation or migration reference only.
- CORE paths (`cicada/`, `core/*.py`, `vendor/cicada-dsl-parser/cicada/`) must never import from `legacy/`.
- If a behavior is needed again, implement it upstream in `cicada-tg` or through an adapter outside CORE.
