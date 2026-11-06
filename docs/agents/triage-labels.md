# Triage Label Vocabulary

This repository's engineering skills use five canonical triage roles. Provider-specific labels or tags may differ, but every role maps to exactly one configured string.

| Canonical role | Tracker label or tag |
| --- | --- |
| `needs-triage` | `needs-triage` |
| `needs-info` | `needs-info` |
| `ready-for-agent` | `ready-for-agent` |
| `ready-for-human` | `ready-for-human` |
| `wontfix` | `wontfix` |

## Consumer Rules

- Read this mapping before applying or removing triage state.
- Reuse configured strings exactly.
- Do not create a near-duplicate label when a canonical role already maps to existing tracker vocabulary.
- Preserve unrelated labels or tags.
- Treat the mapping as vocabulary, not as proof that the provider-side labels already exist.
