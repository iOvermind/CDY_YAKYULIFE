# Domain docs

## Layout

**Single-context** — this repo uses one context root at the repo top level.

- `CONTEXT.md` — high-level domain context, key concepts, and architectural decisions summary
- `docs/adr/` — Architecture Decision Records (ADR files in `NNNN-title.md` format)

## Consumer rules

1. **Read `CONTEXT.md` first** when starting work in an unfamiliar area of the codebase.
2. **Read relevant ADRs** before proposing changes that touch architectural boundaries.
3. **Do not modify `CONTEXT.md` or ADRs** unless explicitly asked — these are human-curated documents.
4. **Reference ADRs by number** (e.g. "per ADR-0003") when a decision is relevant to a code change.
