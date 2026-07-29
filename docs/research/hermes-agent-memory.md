# Hermes Agent memory implementation: findings for obsidian-agent-tools

Research date: 2026-07-28
Hermes Agent revision reviewed: [`2e9559a`](https://github.com/NousResearch/hermes-agent/tree/2e9559adf0583b174e67870872f8ed2ce6855032)

## Executive summary

Hermes has two deliberately different memory planes:

1. **Built-in, always-available curated memory**: two small files, `MEMORY.md` (agent/environment knowledge, 2,200 characters) and `USER.md` (user profile, 1,375 characters). They are loaded once and injected as a frozen system-prompt snapshot at session start.
2. **On-demand session history**: all conversations are retained in SQLite/FTS5 and searched only when needed. This avoids paying the token cost of putting the entire history in every prompt.

Hermes also supports one optional external memory provider at a time. Providers can prefetch context, persist completed turns, expose memory tools, extract at session end, and contribute before compression. The provider manager treats these operations as best-effort and isolates slow/failing backends with timeouts and background workers.

For `obsidian-agent-tools`, the strongest transferable ideas are **separating always-injected curated facts from searchable history**, **strict bounded prompt budgets**, **frozen prompt snapshots**, **atomic/concurrency-safe writes**, **pre-compression capture**, and **explicit provider lifecycle seams**. The parts not to copy are Hermes's monolithic two-file layout and delimiter-based storage: Obsidian's individual Markdown notes, frontmatter, source links, and human review are a better canonical store.

## What Hermes actually implements

### 1. Bounded curated memory with a stable snapshot

`~/.hermes/memories/MEMORY.md` and `USER.md` are parsed into entries separated by `§`. Each store has a hard character limit. Writes that exceed the limit fail with the current entries so the agent can consolidate explicitly; memory does not silently compact or discard content ([official memory guide](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md), [implementation](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L205-L451)).

At session initialization, Hermes deduplicates and scans entries for prompt-injection/exfiltration patterns. It renders a sanitized snapshot into the system prompt; later `add`, `replace`, and `remove` calls persist immediately but **do not alter the current prompt**. The frozen snapshot preserves prefix-cache stability and prevents mid-session memory changes from silently changing the instruction prefix ([`MemoryStore.load_from_disk`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L205-L239), [`format_for_system_prompt`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L732-L757), [guide explanation](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md#how-memory-appears-in-the-system-prompt)).

Writes are protected by a lock and atomic temp-file replacement. Read-modify-write operations refuse to overwrite an unreadable or externally drifted file, and batch operations are all-or-nothing against the final character budget ([file locking/drift handling](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L241-L390), [batch and atomic write](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L564-L603), [atomic replacement](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L866-L894)).

### 2. Curated memory and searchable history are separate

The curated stores are always available and cost roughly 1,300 tokens per session. Session search uses SQLite FTS5 and returns actual historical messages without LLM summarization; it is intended for questions such as “did we discuss X last week?” ([memory guide: session search](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md#session-search), [comparison table](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md#session-search-vs-memory)).

This maps well to the current project: durable notes are the curated source of truth, while `_agent_sessions` and other historical notes/indexes should remain searchable evidence rather than automatically injected durable rules. The existing project already documents this boundary in [`README.md`](../../README.md#agent-memory) and the OpenClaw comparison recommends preserving separate scoped Obsidian notes ([`docs/research/openclaw-memory-lessons.md`](openclaw-memory-lessons.md#what-not-to-copy-directly)).

### 3. Provider interface and lifecycle hooks

External providers implement `MemoryProvider`. Required seams are availability/configuration, initialization, tool schemas, and tool dispatch. Optional seams cover static system-prompt text, pre-turn recall, queued next-turn prefetch, post-turn synchronization, session end, session switching, pre-compression extraction, built-in memory-write mirroring, delegation observations, and backup paths ([ABC](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_provider.py#L34-L145), [optional hooks](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_provider.py#L158-L315), [plugin guide](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/developer-guide/memory-provider-plugin.md#the-memoryprovider-abc)).

The manager allows only one external provider, always keeps the built-in provider, labels/merges provider prompt blocks, fences recalled context, and routes provider tools by name. It runs external prefetch in a daemon thread with an 8-second timeout; post-turn sync and queued prefetch run through a serialized single-worker background executor, so a broken network service cannot hold the user-facing turn open ([`MemoryManager.prefetch_all`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_manager.py#L525-L637), [`sync_all`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_manager.py#L638-L735), [manager lifecycle](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_manager.py#L877-L1003)). Shutdown drains queued work for a bounded period and reports abandoned writes rather than blocking forever ([shutdown](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_manager.py#L1144-L1222)).

### 4. Compression is a memory boundary

The `on_pre_compress(messages)` hook lets a provider extract durable insights from messages immediately before context compression discards them. The returned text is included in the compressor's summary prompt. The plugin guide also exposes `on_session_end` for final extraction and `on_session_switch` for rebinding session-scoped state ([hook contract](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_provider.py#L220-L278), [provider lifecycle table](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/developer-guide/memory-provider-plugin.md#optional-hooks)).

This is complementary to the existing project's post-compaction session-summary path. Where a harness exposes a pre-compaction event, a bounded staging note can preserve facts before they are summarized away; canonical durable notes should remain reviewable and should not be mutated implicitly.

### 5. Writes have optional approval and security controls

Hermes defaults to free writes but supports `memory.write_approval: true`; interactive writes prompt inline, while background/gateway writes are staged and reviewed with `/memory pending`, `/memory approve`, or `/memory reject` ([approval documentation](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md#controlling-memory-writes-write_approval)). Memory content is scanned both at write time and when loaded for prompt injection/exfiltration; blocked entries remain visible in live state so they can be removed rather than silently disappearing ([scanner and snapshot sanitization](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L88-L116), [sanitization](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py#L205-L239)).

## Comparison with obsidian-agent-tools

| Concern | Hermes Agent | `obsidian-agent-tools` | Finding |
|---|---|---|---|
| Canonical storage | Two bounded delimiter files | Individual Markdown notes under `3_Resource/agent memory/`, with frontmatter and source metadata | Keep Obsidian's note granularity and human-editable canonical source. |
| Always-injected context | Frozen `MEMORY.md`/`USER.md` snapshot at session start | Conservative pre-turn retrieval of active/confirmed scoped memories, small output budget | Keep bounded retrieval. Consider a per-turn immutable snapshot only if prefix-cache stability is important to a supported harness. |
| Historical recall | SQLite FTS5, on demand, full messages | Session summaries and vault index; semantic/manual search available | Preserve the distinction between “always-known rule” and “searchable evidence”; return source paths/line ranges. |
| Write safety | Hard limits, threat scanning, locks, atomic replacement, drift refusal, optional approval | MCP/CLI write paths with read-back verification and lifecycle rules | Hermes validates the value of atomic writes and approval staging; adapt these around Markdown rather than replacing the note model. |
| Retrieval lifecycle | Prefetch, async sync, session-end, pre-compress, session-switch hooks | Pre-turn context, session-end summaries, post-compaction integration | Add a pre-compaction staging seam where the runtime supports it; keep all adapters thin and shared. |
| External backends | One selected provider, provider tools + lifecycle hooks | Local Markdown/SQLite/Ollama, cross-harness shared core | A provider abstraction is useful if additional stores are added, but one active backend avoids conflicting memories and tool bloat. |
| Trust boundary | Built-in memory is injected as system-prompt content; external recall is fenced as memory context | Durable/project/broad memory have different scope and confidence, but rendering should remain conservative | Label recalled excerpts as untrusted reference/evidence; never let memory authorize actions or override current instructions. |

## Recommendations

1. **Keep the two-plane model.** Treat confirmed durable notes as bounded guidance and session/project/daily notes as searchable evidence. Do not inject the whole vault or automatically promote search hits into durable notes.
2. **Adopt Hermes's write guarantees.** For Markdown mutation, use lock + atomic replace, refuse writes when the source cannot be read faithfully, and verify the result. A review/staging mode is preferable for inferred facts or cross-harness writes.
3. **Add a pre-compaction staging hook.** Save a bounded, local session-memory artifact before compression when possible; let normal capture/review promote facts later. This complements, rather than replaces, post-compaction summaries.
4. **Make lifecycle seams explicit.** A provider/integration contract should distinguish pre-turn recall, post-turn persistence, session-end extraction, session switching, and pre-compression extraction. Keep network/LLM work off the response path with bounded shutdown behavior.
5. **Preserve scope and provenance in every result.** Hermes's built-in files lack the richer scope/frontmatter model already present here. Keep source path, note scope, status, confidence, and applicable conditions attached to snippets and visible in diagnostic output.
6. **Use frozen snapshots selectively.** Hermes's snapshot is primarily a cache/performance invariant. For the current lexical hot path, retaining the existing per-turn lookup may be simpler; consider snapshotting only the durable block during a session, while still allowing explicit search to see live notes.
7. **Do not copy monolithic storage or delimiter syntax.** They are appropriate for Hermes's compact always-injected stores, not for a linked Obsidian vault.

## Primary sources and revision

All Hermes claims above were checked against first-party repository documentation and source at commit [`2e9559adf0583b174e67870872f8ed2ce6855032`](https://github.com/NousResearch/hermes-agent/commit/2e9559adf0583b174e67870872f8ed2ce6855032). Key files:

- [`website/docs/user-guide/features/memory.md`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/user-guide/features/memory.md)
- [`website/docs/developer-guide/memory-provider-plugin.md`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/website/docs/developer-guide/memory-provider-plugin.md)
- [`tools/memory_tool.py`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/tools/memory_tool.py)
- [`agent/memory_provider.py`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_provider.py)
- [`agent/memory_manager.py`](https://github.com/NousResearch/hermes-agent/blob/2e9559adf0583b174e67870872f8ed2ce6855032/agent/memory_manager.py)
