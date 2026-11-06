# Domain Documentation: Single Context

This repository uses one domain context.

## Locations

- Glossary: root `CONTEXT.md`
- Architecture Decision Records: root `docs/adr/`

## Consumer Rules

- Read `CONTEXT.md` before introducing or interpreting domain vocabulary.
- Treat it as an opinionated glossary, not an implementation specification, scratch pad, or project history.
- Add only domain-specific concepts with concise definitions.
- Create `CONTEXT.md` lazily when the first term is explicitly resolved.
- Create `docs/adr/` lazily when the first qualifying decision is approved for recording.

Offer an Architecture Decision Record only when the decision is costly to reverse, surprising without rationale, and the result of a genuine tradeoff. All three conditions are required.
