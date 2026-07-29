# Architecture

This document maps the current shape of `obsidian-agent-tools`: entry points, the
files each entry point calls into, and the runtime flows that connect them.
It's a snapshot, not a design target — see the codebase itself for ground truth
as it evolves.

## Entry points

The project exposes four independent front doors. None of them go through a
shared "app" object — each is a small script that imports directly from `src/`.

```mermaid
flowchart TB
    subgraph Consumers
        PI["pi coding agent"]
        CC["Claude Code"]
        MCPClient["Any MCP client"]
        Human["Terminal / scripts"]
    end

    subgraph "Entry points"
        PiExt["integrations/pi/obsidian-agent-tools.ts\n(pi extension: hooks + obsidian-bootstrap command)"]
        PiHandover["integrations/pi/handover.ts\n(pi extension: /handover command)"]
        CCHooks["integrations/claude-code/*\n(on-user-prompt-submit, session-adapter.mjs, on-post-compact)"]
        McpServer["src/index.ts\n(MCP server, stdio transport)"]
        BinContext["bin/obsidian-agent-context"]
        BinSearch["bin/obsidian-agent-search"]
        BinSummarize["bin/obsidian-agent-summarize"]
    end

    PI --> PiExt
    PI --> PiHandover
    CC --> CCHooks
    MCPClient --> McpServer

    PiExt -->|execFile / spawn| BinContext
    PiExt -->|execFile / spawn| BinSearch
    PiExt -->|spawn, fire-and-forget| BinSummarize
    CCHooks -->|execFile / spawn| BinContext
    CCHooks -->|spawn, fire-and-forget| BinSummarize
    Human --> BinContext
    Human --> BinSearch
    Human --> BinSummarize

    BinContext --> MemCmd["src/commands/memory-context.ts"]
    BinSearch --> SearchCmd["src/commands/search-vault.ts"]
    BinSummarize --> Summarizer["src/summarizer/index.ts"]

    McpServer --> Tools["src/tools/*.ts\n(15 registerXTools functions)"]
```

**Why two front doors (CLI binaries and MCP)?** They serve different
integration mechanisms, not indecision — pi's hooks shell out to a plain
subprocess and read stdout; Claude Code's MCP client speaks the MCP
tool-calling protocol. Both binaries and MCP tools call into the same
`src/` library code underneath (`search/vault-search.ts`, `memory/retrieve.ts`,
`core/config.ts`).

## Module map

| Directory | Responsibility |
|---|---|
| `src/tools/` | MCP tool registrations (`registerXTools(server)`). Most are thin wrappers over `cli.ts` (`execObsidian`) for vault CRUD (`vault.ts`, `read.ts`, `write.ts`, `tags.ts`, `aliases.ts`, `properties.ts`, `property-write.ts`, `tasks.ts`, `task-update.ts`, `manage.ts`, `graph.ts`, `search.ts`). `session.ts`, `search-vault.ts`, `search-sessions.ts` are the exceptions — they hold real logic (see flows below). |
| `src/commands/` | CLI-entry logic invoked by the `bin/` scripts: `memory-context.ts` (memory retrieval), `search-vault.ts` (vault search + status). |
| `src/core/` | Config (`config.ts`, the `AgentConfig` seam) and the session-summarization pipeline (`session-pipeline.ts`, `session-format.ts`, `session-writer.ts`, `ollama.ts`). |
| `src/search/` | Vault semantic/keyword search stack: `embed.ts` (Ollama embeddings), `vault-indexer.ts` (chunk + sync to SQLite), `vault-search.ts` (query + merge + format), `retrieval-policy.ts` (candidate scoring/confidence), `rewrite.ts` (query cleanup). Also `hybrid.ts`, a second, separate hybrid-search implementation for the legacy session-summaries store. |
| `src/memory/` | Automatic memory-context retrieval: `retrieve.ts` (tiered durable/project/broad search), `render.ts` (Markdown rendering), `types.ts`. |
| `src/db/` | Two SQLite-backed stores: `vault-index.ts` (vault chunks, FTS5 + `vec0`, used by the search stack) and `index.ts` (legacy `summaries.db`, FTS5 + `vec0`, used only by `tools/search-sessions.ts`). |
| `src/summarizer/` | Entry point that turns a raw session transcript into a written summary via `core/session-pipeline.ts`. |
| `src/cli.ts` | `execObsidian()` — shells out to the actual Obsidian.app CLI for vault reads/writes. |
| `integrations/pi/` | pi extension: memory-context injection hook, session-shutdown summarization hook, `obsidian-bootstrap` command, `/handover` command. |
| `integrations/claude-code/` | Claude Code hook scripts, functionally mirroring the pi extension's two hooks. |

## Flow: MCP server tool dispatch

```mermaid
flowchart LR
    Client["MCP client\n(Claude Code)"] -->|stdio| Server["src/index.ts\nMcpServer"]
    Server --> T1["tools/vault.ts, read.ts, write.ts,\ntags.ts, aliases.ts, properties.ts,\nproperty-write.ts, tasks.ts,\ntask-update.ts, manage.ts,\ngraph.ts, search.ts"]
    Server --> T2["tools/session.ts\n(context / morning / seed)"]
    Server --> T3["tools/search-vault.ts"]
    Server --> T4["tools/search-sessions.ts"]

    T1 -->|execObsidian| CLI["src/cli.ts"]
    T2 -->|execObsidian| CLI
    CLI -->|execFile| ObsCLI["Obsidian.app CLI"]

    T3 --> VS["search/vault-search.ts"]
    T4 --> Hybrid["search/hybrid.ts"]

    VS --> VaultDB[("db/vault-index.ts\nvault-index.db")]
    Hybrid --> SummDB[("db/index.ts\nsummaries.db")]
```

`tools/session.ts`'s `seed` action is the one tool that mixes concerns: it
calls `execObsidian` for reads/backlinks/links, then does its own in-handler
graph traversal (BFS over depth 1–2, dedupe, budget) and Markdown assembly —
271 lines in one handler for three actions (`context`, `morning`, `seed`).

## Flow: automatic memory-context retrieval

Triggered before every agent turn (pi's `before_agent_start`, Claude Code's
`on-user-prompt-submit`).

```mermaid
flowchart TB
    Hook["before_agent_start (pi) /\non-user-prompt-submit (Claude Code)"]
    Hook -->|execFile, 5s timeout| BinContext["bin/obsidian-agent-context"]
    BinContext --> MemCmd["commands/memory-context.ts"]
    MemCmd --> Config["core/config.ts\nloadConfig()"]
    MemCmd --> Retrieve["memory/retrieve.ts\nretrieveMemoryContext()"]
    Retrieve -->|"durable tier\n(3_Resource/agent memory/, status=active)"| Search["search/vault-search.ts\nsearchVault()"]
    Retrieve -->|"project tier\n(1_Projects/<repo-or-project>)"| Search
    Retrieve -->|"broad tier, only if prompt matches BROAD_HINT"| Search
    Search --> Indexer["search/vault-indexer.ts\nsyncVaultIndex() — incremental"]
    Indexer --> VaultDB[("vault-index.db")]
    Search --> Policy["search/retrieval-policy.ts\nmerge keyword + vector, score, confidence"]
    Retrieve --> Render["memory/render.ts"]
    Render --> Hook
    Hook -->|injected as hidden system message| Agent["agent turn"]
```

## Flow: vault search (interactive)

```mermaid
flowchart LR
    MCP["tools/search-vault.ts\n(obsidian_search_vault)"] --> VS
    CLIcmd["commands/search-vault.ts\n(obsidian-agent-search vault)"] --> VS
    VS["search/vault-search.ts\nsearchVault()"] --> Sync["vault-indexer.ts\nsyncVaultIndex()"]
    Sync -->|hash/mtime unchanged| Skip[skip]
    Sync -->|changed or new| Chunk["chunkMarkdown()\nheading-aware, token-budgeted"]
    Chunk --> Embed["search/embed.ts\nOllama nomic-embed-text"]
    Embed --> DB[("vault-index.db\nvault_notes, vault_chunks,\nvault_chunk_fts, vault_chunk_vec")]
    VS --> Keyword["keywordCandidates()\nFTS5 BM25"]
    VS --> Vector["vectorCandidates()\nsqlite-vec cosine"]
    Keyword --> DB
    Vector --> DB
    Keyword --> Merge["retrieval-policy.ts\napplyRetrievalPolicy()"]
    Vector --> Merge
    Merge --> Format["vault-search.ts\nformatVaultResults()"]
    Format --> MCP
    Format --> CLIcmd
```

`formatVaultResults()` and `loadConfig()` are the two shared seams both
adapters call through — as of the latest refactor, neither adapter
reimplements config resolution or result formatting locally.

## Flow: session summarization

Triggered on session end (pi `session_shutdown` with `reason: "quit"`, Claude
Code's `session-adapter.mjs`/`on-post-compact`).

```mermaid
flowchart TB
    PiShutdown["pi: session_shutdown hook"] -->|"writeFileSync session.json\n+ spawn, detached, unref"| Temp[("tmp/.../session.json")]
    CCEnd["Claude Code: session-adapter.mjs\n/ on-post-compact"] -->|"writeFileSync session.json\n+ spawn, detached, unref"| Temp

    Temp --> BinSummarize["bin/obsidian-agent-summarize"]
    BinSummarize --> SummIndex["summarizer/index.ts"]
    SummIndex --> Pipeline["core/session-pipeline.ts\ncreateSessionPipeline()"]
    Pipeline --> Format["core/session-format.ts\nvalidateNormalizedSession()\nformatTranscript()"]
    Pipeline --> Ollama["core/ollama.ts\nensureModel() + summarize()"]
    Ollama -->|HTTP| OllamaSvc[(Ollama)]
    Pipeline --> Writer["core/session-writer.ts\nappend() with file lock"]
    Writer --> DailyFile[("4_Archive/_agent_sessions/...\nMarkdown session log")]
```

Both hooks are fire-and-forget: the parent process (`pi` or Claude Code)
never waits for the summarizer to finish.

## Duplication already known

Two structural duplications are tracked but not yet resolved — see the
architecture review from 2026-07-29 for the full before/after analysis:

- **Two hybrid-search stacks.** `search/hybrid.ts` + `db/index.ts` (session
  summaries) and `search/vault-search.ts` + `db/vault-index.ts` (vault chunks)
  independently wire FTS5 + `vec0` + embedding storage for the same underlying
  problem. `docs/migration-from-claude-obsidian.md` already frames the vault
  stack as "the generalized successor" — consolidating them into one
  hybrid-search interface with two corpus adapters is the stated direction,
  not a new idea.
- **`tools/session.ts` is a shallow dispatcher with a deep algorithm buried
  inside it.** The `seed` action's graph traversal (backlinks/outlinks,
  depth 1–2, dedupe, budget) has no seam of its own — it can only be
  exercised through the full MCP call surface. Extracting a
  `buildGraphContext()` module would let it be tested directly.
