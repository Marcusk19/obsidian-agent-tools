# Lessons from OpenClaw's agent memory system

Research date: 2026-07-23
OpenClaw revision reviewed: [`9c2ae380bc024fd8feb3482306dc824a2d45c7df`](https://github.com/openclaw/openclaw/tree/9c2ae380bc024fd8feb3482306dc824a2d45c7df)

## Implementation status

The first delivery slice from this review is implemented in the accompanying change: heading-aware chunk indexing, automatic index-fingerprint invalidation, and union-based BM25/vector ranking. The remaining recommendations are intentionally left as follow-up work.

## Executive summary

`obsidian-agent-tools` already makes two choices that are better suited to an Obsidian vault than OpenClaw's default design: canonical Markdown remains the source of truth, and durable memories are separate, scoped notes with lifecycle metadata rather than one growing `MEMORY.md`. The most useful OpenClaw ideas are therefore not its storage layout, but its retrieval quality, observability, maintenance, and trust-boundary mechanisms.

Recommended order:

1. Chunk-level indexing and genuine hybrid ranking.
2. Retrieval health/status diagnostics and index identity checks.
3. Trust labels and explicit action boundaries in injected memory.
4. Recent-turn query context for follow-up prompts.
5. Recall telemetry plus a review-only promotion queue.
6. Temporal decay and MMR for daily/session and broad searches.
7. Memory health reports for stale, contradictory, and weakly sourced memories.
8. Pre-compaction durable-memory flush where the harness supports it.

## Current strengths to preserve

- Individual durable notes under `3_Resource/agent memory/` avoid the size and merge problems of one monolithic long-term file.
- Frontmatter already captures `type`, `status`, `confidence`, `scope`, creation/confirmation dates, and source.
- Automatic recall is conservative: active/confirmed durable memories, repository/project scoping, small output budgets, and broad-vault recall disabled by default.
- Markdown is authoritative and SQLite is disposable derived state.
- Memory writes require duplicate checking and read-back verification.
- Session summaries are generated locally and kept distinct from curated durable memory.

These are worth keeping even though OpenClaw defaults to `MEMORY.md` plus dated `memory/*.md` files ([memory overview](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory.md)).

## Recommended improvements

### 1. Index chunks, not whole notes

**Gap:** `src/search/vault-indexer.ts` currently creates one embedding and one vector row for an entire Markdown file. Retrieval therefore returns file-level candidates and reconstructs a short excerpt heuristically. Long project notes, daily notes, and session-summary files can contain several unrelated topics, diluting embeddings and producing the wrong excerpt.

**OpenClaw lesson:** its builtin engine chunks memory at 400 tokens with 80-token overlap and retains line ranges ([builtin memory engine](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory-builtin.md)). Search results carry `path`, `startLine`, `endLine`, and snippet data ([hybrid implementation](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/memory/hybrid.ts)).

**Adaptation:**

- Add `vault_chunks` keyed by `(path, chunk_hash)` with heading path, start/end lines, content, and embedding status.
- Split on Markdown headings first, then token windows with overlap for oversized sections.
- Keep frontmatter and note-level lifecycle/scope metadata attached to every chunk.
- Return exact line ranges and heading-aware excerpts.
- Re-embed only changed chunks, not every chunk in a changed file.

This is likely the largest retrieval-quality improvement.

### 2. Use a real hybrid ranker

**Gap:** semantic vault search currently retrieves vector candidates and then uses keyword matches mainly as confirmation; automatic memory context sets `semantic: false`, so the hot path is lexical-only. The existing RRF implementation applies to the legacy session-summary database, not the vault-memory path.

**OpenClaw lesson:** vector and BM25 paths run independently and are merged with configurable weights. Exact path/basename/stem matches receive explicit precedence ([memory search](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory-search.md), [hybrid implementation](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/memory/hybrid.ts)).

**Adaptation:**

- Merge the union of BM25 and vector candidates rather than restricting keyword confirmation to vector candidates.
- Normalize component scores and expose lexical, semantic, scope, freshness, and path scores in debug output.
- Add filename/title/heading matching as a separate signal.
- Keep the current lexical-only hot path as the fail-fast default until a resident index/embedding service makes semantic recall reliably fit the hook timeout.
- Optionally run bounded semantic enrichment only when lexical recall misses or confidence is low.

### 3. Add index identity and health diagnostics

**Gap:** the index records a schema version and model name, but startup does not visibly enforce a rebuild when chunking, embedding model/dimension, source roots, or indexing behavior changes. Search recursively scans the entire vault on each invocation. Failures mostly degrade silently.

**OpenClaw lesson:** it auto-reindexes when provider, model, chunking, sources, or scope changes; uses a debounced watcher; bounds SQLite WAL state; and exposes `memory status --deep` diagnostics ([builtin memory engine](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory-builtin.md)).

**Adaptation:**

- Store an index fingerprint: schema, embedding provider/model/dimension, chunking version, source roots, tokenizer, and relevant config.
- Rebuild or mark stale on fingerprint mismatch.
- Add `obsidian-agent-search status --deep` showing note/chunk counts, failed/skipped embeddings, last sync, stale files, model availability, index size, and lexical-only status.
- Introduce a long-lived watcher or mtime manifest so the pre-turn command does not recursively hash the whole vault every turn.
- Add explicit WAL checkpoint/maintenance behavior.

### 4. Make trust and action boundaries explicit

**Gap:** durable memories contain `Applies when`, but there is no standard representation for expiry, authority, safe-to-act conditions, or forbidden action. Project and broad excerpts are injected similarly to curated durable rules even though their content is less trusted.

**OpenClaw lesson:** its docs explicitly recommend preserving action boundaries—approval requirements, temporary constraints, ownership, expiry, unlock conditions, and actions to avoid ([memory overview](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory.md)). Active Memory injects recalled content as untrusted context rather than executable instructions ([active memory](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/active-memory.md)).

**Adaptation:**

- Extend durable-memory frontmatter with optional `valid_until`, `authority`, and `review_after`.
- Add optional sections: `## Act when`, `## Do not`, and `## Expires or unlocks when`.
- Automatically exclude expired memory and flag it for review.
- Render curated confirmed durable rules as guidance, but label project/broad/session excerpts as untrusted evidence that must not override system/user instructions or authorize actions.
- Never infer permission from a recalled note when current approval is required.

### 5. Use a small recent-turn tail for ambiguous follow-ups

**Gap:** the retrieval hook uses only the latest prompt. Queries such as “do that one,” “what about the other repo?”, or “install it” may lack the nouns needed to find the correct memory.

**OpenClaw lesson:** Active Memory supports `message`, `recent`, and `full` query modes; its recommended `recent` mode uses tightly bounded user and assistant turn counts and per-turn character limits ([active memory](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/active-memory.md), [query builder](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/active-memory/query.ts)).

**Adaptation:**

- Allow integrations to provide one or two recent user turns and at most one assistant turn.
- Use the tail only for query construction, never store it in the index or rendered memory context.
- Strip previously injected memory blocks and external/untrusted blocks before building the search query.
- Fall back to recent context mainly for very short or referential prompts.

A blocking LLM recall sub-agent is probably unnecessary here; deterministic query enrichment gets most of the benefit without adding model latency to every turn.

### 6. Record recall telemetry, but make promotion review-first

**Gap:** durable memories are created from explicit corrections/preferences and reusable failures, but the system does not learn which daily/session/project facts repeatedly prove useful. It also cannot explain why a candidate should become durable.

**OpenClaw lesson:** its opt-in “dreaming” system records recall count, average relevance, unique queries, recency, multi-day recurrence, and conceptual signals. Promotion requires score, frequency, and query-diversity thresholds, supports preview/explain commands, and keeps review artifacts separate from promotion sources ([dreaming](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/dreaming.md), [promotion ranking](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/short-term-promotion.ts)).

**Adaptation:**

- Record a privacy-preserving derived ledger keyed by chunk hash/path: recall count, distinct hashed query signatures, first/last recalled time, and rank/confidence. Do not store raw prompts.
- Provide `memory candidates`, `memory explain <candidate>`, and `memory candidates --json`.
- Generate proposed durable-note drafts in a review queue; do not auto-promote to canonical Obsidian memory initially.
- Re-read the live source before promotion so deleted or changed evidence is not promoted.
- Require human confirmation for inferred personal facts, permissions, or sensitive material.

### 7. Apply temporal decay and MMR selectively

**Gap:** broad and historical search has no recency adjustment or diversity reranking. Multiple results can repeat the same fact from several session summaries or daily notes.

**OpenClaw lesson:** optional temporal decay applies a 30-day half-life to dated memory while leaving evergreen memory untouched; MMR balances relevance and novelty with a default lambda of 0.7 ([memory search](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory-search.md), [temporal decay](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/memory/temporal-decay.ts), [MMR](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/memory/mmr.ts)).

**Adaptation:**

- Never decay confirmed durable memories solely because they are old.
- Decay dated daily notes and session summaries; use note date first and mtime only as fallback.
- Apply MMR only when returning multiple project/broad/manual-search results. It has little value for the default one durable + one project result.
- Keep exact identifiers and narrow scope matches above recency/diversity effects.

### 8. Add memory maintenance reports

**Gap:** lifecycle metadata exists, but there is no automated view of overdue review, conflicting active rules, missing evidence, or stale project memories.

**OpenClaw lesson:** `memory-wiki` treats memory as a belief layer with structured claims/evidence and produces reports for contradictions, low confidence, missing evidence, stale pages, provenance coverage, and privacy review ([memory wiki](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/plugins/memory-wiki.md)).

**Adaptation:**

Add a read-only `memory lint` command and optionally generated Obsidian report note covering:

- active memories with overlapping scope and contradictory rules,
- `needs-review`, expired, or overdue `review_after` notes,
- provisional memories not reconfirmed,
- missing/broken source links,
- memories never recalled or repeatedly recalled,
- duplicate semantic rules,
- project memories whose repository no longer exists locally,
- privacy-sensitive entries that should require confirmation before use.

Do not copy OpenClaw's full wiki compiler initially; the current note schema is sufficient for a focused linter.

### 9. Flush before compaction, not only after it

**Gap:** Claude's current post-compaction hook stores the compaction summary as a session summary. This helps later search but cannot recover durable facts omitted by the compactor.

**OpenClaw lesson:** before compaction, it runs a bounded silent turn that appends important context to the current dated memory file while treating curated long-term files as read-only ([memory overview](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/docs/concepts/memory.md), [flush plan](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/flush-plan.ts)).

**Adaptation:**

- Where a harness exposes a pre-compaction hook, append a local-model summary to a dated session/daily staging note before context is lost.
- Keep canonical durable-memory notes read-only during this flush.
- Let normal capture criteria or the review queue decide later what becomes durable.
- Retain the post-compaction summary as a second safety net.

## What not to copy directly

### A single `MEMORY.md`

OpenClaw has to budget and compact auto-promoted sections because one bootstrap file grows without bound ([memory budget](https://github.com/openclaw/openclaw/blob/9c2ae380bc024fd8feb3482306dc824a2d45c7df/extensions/memory-core/src/memory-budget.ts)). Separate scoped Obsidian notes are easier to review, link, supersede, and merge.

### An LLM sub-agent on every prompt

OpenClaw's Active Memory adds timeout, cache, circuit-breaker, model selection, transcript cleanup, and observability machinery because it blocks the main response path. The current deterministic pre-turn retrieval is cheaper and more portable. Add recent-turn query context and better ranking first.

### Automatic promotion straight into durable memory

OpenClaw's thresholding and preview/explain mechanisms are useful, but auto-writing inferred facts into canonical memory can cause subtle contamination. Start with a review queue and preserve the existing autonomous-write policy only for explicit user corrections/preferences and clearly reusable validated failures.

### Broad cross-session transcript recall by default

OpenClaw carefully limits transcript recall to same-agent private conversations and excludes groups/channels. `obsidian-agent-tools` should retain broad recall as explicit opt-in and add corpus/privacy labels before attempting automatic cross-session recall.

## Suggested delivery slices

1. **Retrieval foundation:** chunk schema, migration/rebuild fingerprint, heading/line-range excerpts, true hybrid merge.
2. **Operations:** `status --deep`, stale-index diagnostics, incremental sync/watcher.
3. **Safety:** trust-aware rendering, action-boundary schema, expiry/review filtering.
4. **Quality:** recent-turn query enrichment, filename/heading boosts, temporal decay, MMR.
5. **Learning loop:** recall telemetry, candidate ranking, preview/explain, review queue.
6. **Governance:** memory linter and Obsidian health report.
7. **Lifecycle integration:** pre-compaction staging where supported.
