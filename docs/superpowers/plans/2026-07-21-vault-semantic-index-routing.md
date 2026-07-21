# Vault Semantic Index and Search Routing Implementation Plan

> **For agentic workers:** This plan is documentation only. Do not automatically invoke implementation subskills. If the user explicitly requests execution, ask them to choose an execution skill first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rebuildable `vault-index.db` for every Markdown note in the Obsidian vault and route agent-memory retrieval through semantic search followed by targeted keyword confirmation.

**Architecture:** Keep `summaries.db` isolated and create `src/db/vault-index.ts` for the new note index. A vault indexer incrementally synchronizes Markdown files by path/hash, while `src/search/vault-search.ts` performs semantic retrieval, candidate-scoped FTS confirmation, confidence labeling, and keyword fallback. MCP and CLI adapters call the same search function, and the agent-memory skill uses the CLI/MCP route instead of direct keyword search.

**Tech Stack:** TypeScript 5.8+, Node.js >=18, Vitest, better-sqlite3, sqlite-vec, SQLite FTS5, Ollama `nomic-embed-text`, Obsidian CLI, MCP SDK.

## Global Constraints

- Markdown files are the authoritative source of truth; `vault-index.db` is disposable derived state.
- Index every Markdown file beneath `OBSIDIAN_VAULT`, including generated `_agent_sessions` notes.
- Store the new index at `$OBSIDIAN_DATA_DIR/vault-index.db`.
- Do not migrate records from `summaries.db`; the new index starts from a vault Markdown rebuild.
- Keep the embedding model fixed at `nomic-embed-text` with 768 dimensions.
- Refresh lazily during search; do not add a long-running filesystem watcher.
- Preserve keyword search when Ollama or vector indexing is unavailable.
- Return semantic-only candidates as lower-confidence results when keyword confirmation finds no exact match.
- Keep direct exact `obsidian_search` behavior available; semantic-first routing is a separate interface.
- Expose the routed search as MCP tool `obsidian_search_vault` and CLI command `obsidian-agent-search vault`.
- Support `obsidian-agent-search vault --rebuild` for a complete derived-index rebuild.
- In Pi/non-MCP environments, the agent-memory skill must use the CLI fallback with explicit vault configuration.

---

## File map

### Create

- `src/db/vault-index.ts` — Opens `vault-index.db`, creates its schema, exposes rebuild/connection helpers, and owns note/vector mapping operations.
- `src/search/vault-indexer.ts` — Scans Markdown files and synchronizes new, changed, deleted, unreadable, and embedding-failed notes.
- `src/search/vault-search.ts` — Defines vault search result types and implements semantic retrieval, candidate-scoped keyword confirmation, ranking, and fallback.
- `src/tools/search-vault.ts` — Registers the `obsidian_search_vault` MCP tool and formats routed search results.
- `src/commands/search-vault.ts` — Parses `obsidian-agent-search vault` arguments and calls the shared search/rebuild functions.
- `bin/obsidian-agent-search` — Resolves the repository/dist path and executes the TypeScript CLI output.
- `tests/search/vault-indexer.test.ts` — Tests incremental synchronization and embedding status behavior.
- `tests/search/vault-search.test.ts` — Tests semantic-first routing, confirmation, confidence, and fallback.
- `tests/commands/search-vault.test.ts` — Tests CLI argument parsing and rebuild dispatch.
- `tests/tools/search-vault.test.ts` — Tests MCP registration and response formatting.

### Modify

- `src/index.ts` — Register the new MCP vault-search tool.
- `src/search/embed.ts` — Make the fixed model/dimension contract reusable by vault indexing and query embedding, while preserving best-effort behavior.
- `src/core/session-pipeline.ts` — Stop writing new summaries to the legacy `summaries.db`; Markdown output remains unchanged and is indexed on the next vault search.
- `package.json` — Add the `obsidian-agent-search` binary mapping.
- `module/skills/agent-memory/SKILL.md` — Make semantic vault search the first retrieval step and document CLI fallback behavior.
- `README.md` — Document `vault-index.db`, the new search command/tool, rebuild behavior, and legacy `summaries.db` separation.
- `tests/core/session-pipeline.test.ts` — Replace legacy index assertions with the guarantee that summary writing succeeds without direct database indexing.

---

## Task 1: Define the vault-index database and test fixtures

**Files:**
- Create: `src/db/vault-index.ts`
- Create: `tests/search/vault-indexer.test.ts`
- Modify: `src/search/embed.ts`

**Interfaces:**
- Produces `VaultIndexDatabase`, `VaultNoteRecord`, `openVaultIndex(dataDir)`, and `rebuildVaultIndex(dataDir)` for the indexer and search tasks.
- `openVaultIndex(dataDir: string): VaultIndexDatabase` returns a better-sqlite3 database configured with sqlite-vec and initialized schema.
- `rebuildVaultIndex(dataDir: string): void` removes/recreates only `vault-index.db` derived state.
- `VaultNoteRecord` contains `path`, `title`, `content`, `contentHash`, `mtimeMs`, `embeddingStatus`, `lastEmbeddingError`, and `lastEmbeddingAttempt`.
- `embed(text: string): Promise<number[] | null>` continues to use `nomic-embed-text` and returns `null` on exhausted retries.

- [ ] **Step 1: Write the failing database schema test**

Create a temporary data directory and assert that opening the database creates the required tables and vector dimension:

```ts
it("creates an isolated vault index schema", () => {
  const db = openVaultIndex(tempDir);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow')"
  ).all() as Array<{ name: string }>;

  expect(names.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      "vault_notes",
      "vault_note_fts",
      "vault_note_vec",
      "vault_note_vec_map",
      "vault_index_meta",
    ])
  );
  expect(existsSync(join(tempDir, "vault-index.db"))).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/search/vault-indexer.test.ts
```

Expected: FAIL because `openVaultIndex` and the vault schema do not exist.

- [ ] **Step 3: Implement the isolated schema**

In `src/db/vault-index.ts`:

1. Resolve `join(dataDir, "vault-index.db")`.
2. Create the data directory and open better-sqlite3.
3. Set WAL mode and load sqlite-vec.
4. Create `vault_index_meta` with `key TEXT PRIMARY KEY` and `value TEXT NOT NULL`; insert schema version `1` and model `nomic-embed-text`.
5. Create `vault_notes` with a path primary key, title, content, hash, mtime, embedding status, last error, and last attempt.
6. Create FTS5 `vault_note_fts` with `content`, `title`, and unindexed `path`.
7. Create vec0 `vault_note_vec` with `embedding float[768]`, plus path/title/content fields.
8. Create `vault_note_vec_map(path PRIMARY KEY, vec_rowid INTEGER NOT NULL)`.
9. Export close-safe helpers and rebuild logic.

The schema must not import or call `getDb()` from `src/db/index.ts`; that function remains the legacy session-summary database.

- [ ] **Step 4: Refactor embedding constants without changing behavior**

Export the model name and dimension from `src/search/embed.ts`:

```ts
export const EMBEDDING_MODEL = "nomic-embed-text";
export const EMBEDDING_DIM = 768;
```

Use `EMBEDDING_MODEL` in the Ollama request and preserve the existing retry count, timeout, and `null` return contract.

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
npm test -- tests/search/vault-indexer.test.ts
```

Expected: PASS.

---

## Task 2: Implement lazy Markdown synchronization

**Files:**
- Create: `src/search/vault-indexer.ts`
- Modify: `tests/search/vault-indexer.test.ts`

**Interfaces:**
- Consumes `VaultIndexDatabase` from Task 1 and an injectable `embed` function.
- Produces `syncVaultIndex(options): Promise<SyncReport>`.
- `syncVaultIndex` accepts `{ vaultPath, db, embed?, force?: boolean }`.
- `SyncReport` contains `scanned`, `added`, `updated`, `unchanged`, `deleted`, `keywordOnly`, and `failed` counts.

- [ ] **Step 1: Write tests for new and unchanged notes**

Use a temporary vault with `Notes/first.md`, inject `vi.fn().mockResolvedValue(Array(768).fill(0.1))`, and assert:

```ts
const first = await syncVaultIndex({ vaultPath, db, embed });
expect(first.added).toBe(1);
expect(embed).toHaveBeenCalledTimes(1);

const second = await syncVaultIndex({ vaultPath, db, embed });
expect(second.unchanged).toBe(1);
expect(embed).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the test and verify the new behavior fails**

Run:

```bash
npm test -- tests/search/vault-indexer.test.ts
```

Expected: FAIL because `syncVaultIndex` is not implemented.

- [ ] **Step 3: Implement deterministic Markdown enumeration**

Walk each directory recursively with `readdirSync(directory, { withFileTypes: true })`, skip non-files, and include only case-insensitive `.md` files. Store paths relative to `vaultPath` using POSIX separators. Read UTF-8 content and derive the title from the first Markdown H1, otherwise from the filename without `.md`.

Calculate a SHA-256 content hash and retain `stat.mtimeMs`. Sort paths before processing so tests and logs are deterministic.

- [ ] **Step 4: Implement transactional upsert and unchanged skipping**

For each path, compare stored hash and mtime. If both match, increment `unchanged` and do not call `embed`.

For a new or changed note, use a transaction to:

1. Delete any existing FTS row and vector mapping/vector row.
2. Upsert the canonical `vault_notes` row.
3. Insert the new FTS row.
4. Call the injected embedder for `title + "\n" + content` before committing the vector portion.
5. Insert the vector row and mapping when an embedding is returned.
6. Set `embedding_status` to `ready` or `failed` and record error/attempt fields.

If embedding fails or returns `null`, keep the canonical and FTS rows, set `embedding_status = 'failed'`, and do not retry the same content hash during ordinary lazy sync. `force: true` clears failure state and retries every note.

- [ ] **Step 5: Implement deleted-note cleanup**

After scanning, query indexed paths and remove any path absent from the scan set. Delete its FTS row, vector mapping/vector row, and canonical metadata in one transaction. Increment `deleted`.

- [ ] **Step 6: Add changed, deleted, session-summary, and failed-embedding tests**

Add five concrete tests. Each creates a temporary vault and database, performs the file operation, and asserts both database state and `SyncReport` counts:

```ts
it("replaces changed content and embedding", async () => {
  writeFileSync(join(vaultPath, "note.md"), "# Before\nold text");
  await syncVaultIndex({ vaultPath, db, embed });
  writeFileSync(join(vaultPath, "note.md"), "# After\nnew text");
  const report = await syncVaultIndex({ vaultPath, db, embed });
  expect(report.updated).toBe(1);
  expect(db.prepare("SELECT content FROM vault_notes WHERE path = ?").get("note.md")).toMatchObject({ content: "# After\nnew text" });
});

it("removes notes deleted from the vault", async () => {
  writeFileSync(join(vaultPath, "deleted.md"), "gone");
  await syncVaultIndex({ vaultPath, db, embed });
  unlinkSync(join(vaultPath, "deleted.md"));
  const report = await syncVaultIndex({ vaultPath, db, embed });
  expect(report.deleted).toBe(1);
  expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = ?").get("deleted.md")).toBeUndefined();
});

it("indexes _agent_sessions Markdown like every other note", async () => {
  mkdirSync(join(vaultPath, "4_Archive", "_agent_sessions"), { recursive: true });
  writeFileSync(join(vaultPath, "4_Archive", "_agent_sessions", "2026-01-01.md"), "session summary");
  const report = await syncVaultIndex({ vaultPath, db, embed });
  expect(report.added).toBe(1);
  expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = ?").get("4_Archive/_agent_sessions/2026-01-01.md")).toBeTruthy();
});

it("keeps FTS data when embedding fails and does not retry unchanged failures", async () => {
  const failingEmbed = vi.fn().mockResolvedValue(null);
  writeFileSync(join(vaultPath, "keyword.md"), "explicit vault selector");
  await syncVaultIndex({ vaultPath, db, embed: failingEmbed });
  await syncVaultIndex({ vaultPath, db, embed: failingEmbed });
  expect(failingEmbed).toHaveBeenCalledTimes(1);
  expect(db.prepare("SELECT content FROM vault_note_fts WHERE path = ?").get("keyword.md")).toBeTruthy();
});

it("force rebuild retries failed embeddings", async () => {
  const failingEmbed = vi.fn().mockResolvedValue(null);
  writeFileSync(join(vaultPath, "retry.md"), "retry me");
  await syncVaultIndex({ vaultPath, db, embed: failingEmbed });
  await syncVaultIndex({ vaultPath, db, embed: failingEmbed, force: true });
  expect(failingEmbed).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 7: Run the indexer tests**

Run:

```bash
npm test -- tests/search/vault-indexer.test.ts
```

Expected: PASS.

---

## Task 3: Implement semantic retrieval and candidate-scoped keyword confirmation

**Files:**
- Create: `src/search/vault-search.ts`
- Create: `tests/search/vault-search.test.ts`

**Interfaces:**
- Consumes the database and `syncVaultIndex` from Tasks 1–2.
- Produces `searchVault(options): Promise<VaultSearchResult[]>`.
- `VaultSearchOptions` contains `query`, `vaultPath`, `dataDir`, optional `limit`, optional `embed`, optional `db`, and optional `rebuild`.
- `VaultSearchResult` contains `path`, `title`, `excerpt`, `semanticScore`, `keywordConfirmed`, and `confidence: "confirmed" | "semantic"`.

- [ ] **Step 1: Write failing semantic-first tests**

Seed three notes and mock semantic candidates so the test can prove ordering and routing:

```ts
it("confirms keywords only within semantic candidates", async () => {
  writeFileSync(join(vaultPath, "3_Resource", "agent memory", "cli.md"), "Use an explicit vault selector.");
  writeFileSync(join(vaultPath, "unrelated.md"), "A note about gardening.");
  await syncVaultIndex({
    vaultPath,
    db: openVaultIndex(dataDir),
    embed: vi.fn().mockImplementation(async (text: string) => text.includes("explicit vault selector") ? Array(768).fill(0.9) : Array(768).fill(0.1)),
  });
  const results = await searchVault({
    query: "explicit vault selector",
    vaultPath,
    dataDir,
    embed: queryEmbed,
  });

  expect(results[0]).toMatchObject({
    path: "3_Resource/agent memory/cli.md",
    keywordConfirmed: true,
    confidence: "confirmed",
  });
  expect(results.some((result) => result.path === "unrelated.md")).toBe(false);
});
```

Also test a semantic candidate with no exact keyword match, no semantic results, and Ollama failure.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- tests/search/vault-search.test.ts
```

Expected: FAIL because the shared search function does not exist.

- [ ] **Step 3: Implement query normalization and semantic retrieval**

Normalize whitespace and reject empty queries. Call `syncVaultIndex` first. Embed the normalized query with `nomic-embed-text`; when an embedding is returned, query `vault_note_vec` by distance with a bounded candidate count greater than the requested result limit. Convert rows into candidate records keyed by path.

For testability, keep embedding injectable. Do not expose a production-only `semanticCandidates` option; use a fake database/embedder in tests instead.

- [ ] **Step 4: Implement candidate-scoped FTS confirmation**

Tokenize the query into safe FTS terms using the existing quoting approach. Query `vault_note_fts` with an `IN` path restriction containing only semantic candidate paths. Build an excerpt from the matching note content and mark matching candidates `keywordConfirmed = true` and `confidence = "confirmed"`.

Do not run broad FTS confirmation when semantic candidates exist. This restriction is the key routing guarantee.

- [ ] **Step 5: Implement semantic-only retention and fallback**

Retain semantic candidates not returned by candidate-scoped FTS as `keywordConfirmed = false` and `confidence = "semantic"`. Sort confirmed results before semantic-only results, then by semantic rank/distance.

If embedding/query vector search is unavailable or returns no candidates, run broad FTS search and return keyword results as `confirmed`. If both paths return nothing, return an empty array.

- [ ] **Step 6: Implement rebuild behavior**

When `rebuild: true`, call `rebuildVaultIndex(dataDir)`, open a new database, and run synchronization with `force: true` before querying. The rebuild must not open or modify `summaries.db`.

- [ ] **Step 7: Run routing tests**

Run:

```bash
npm test -- tests/search/vault-search.test.ts
```

Expected: PASS, including semantic-only, keyword fallback, and candidate restriction cases.

---

## Task 4: Remove direct legacy summary indexing

**Files:**
- Modify: `src/core/session-pipeline.ts`
- Modify: `tests/core/session-pipeline.test.ts`

**Interfaces:**
- Consumes the existing session writer and summary pipeline.
- Produces Markdown-only session persistence; `vault-index.db` discovers the output during its next lazy synchronization.

- [ ] **Step 1: Update the pipeline test**

Keep the existing assertion that the summary writer returns a Markdown path. Replace the injected `index` expectation with an assertion that the pipeline does not call the legacy index function:

```ts
const index = vi.fn();
const result = await pipeline.process(input);
expect(result?.path).toContain("_agent_sessions");
expect(index).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/core/session-pipeline.test.ts
```

Expected: FAIL because the current pipeline calls `indexSummary` after writing the Markdown entry.

- [ ] **Step 3: Remove legacy embedding/index dependencies from the pipeline**

Delete the `randomUUID`, `embed`, and `indexSummary` imports and dependency parameters. After `writer.append`, return the path immediately. Preserve all summary generation, writer error handling, and Markdown output behavior.

- [ ] **Step 4: Run pipeline tests and the full suite**

Run:

```bash
npm test -- tests/core/session-pipeline.test.ts
npm test
```

Expected: PASS. No new session summary writes to `summaries.db`.

---

## Task 5: Expose the routed search through MCP

**Files:**
- Create: `src/tools/search-vault.ts`
- Create: `tests/tools/search-vault.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes `searchVault` and `VaultSearchResult` from Task 3.
- Produces MCP tool `obsidian_search_vault` with query, limit, and rebuild parameters.

- [ ] **Step 1: Add MCP registration test coverage**

Use the MCP server's tool listing mechanism and assert that `obsidian_search_vault` is registered alongside the existing `obsidian_search` and `obsidian_search_sessions` tools.

- [ ] **Step 2: Implement the tool schema and handler**

Register:

```ts
server.tool(
  "obsidian_search_vault",
  "Search all Markdown notes using semantic retrieval followed by targeted keyword confirmation.",
  {
    query: z.string(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    rebuild: z.boolean().optional().default(false),
  },
  { readOnlyHint: true },
  async ({ query, limit, rebuild }) => {
    try {
      const results = await searchVault({
        query,
        limit,
        rebuild,
        vaultPath: process.env.OBSIDIAN_VAULT || join(process.env.HOME || "/tmp", "obsidian-git-sync"),
        dataDir: process.env.OBSIDIAN_DATA_DIR || join(process.env.HOME || "/tmp", ".local", "share", "obsidian-agent-tools"),
      });
      const text = results.length === 0
        ? "No matching notes found."
        : results.map((result, index) => [
            `**${index + 1}. ${result.title}** (${result.confidence})`,
            `Path: ${result.path}`,
            result.excerpt,
          ].join("\\n")).join("\\n\\n---\\n\\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `Vault search failed: ${message}` }], isError: true };
    }
  }
);
```

Format confidence explicitly, include path/title/excerpt, and return an MCP error response only for unrecoverable database/configuration errors. Ollama failure must produce keyword fallback results rather than an MCP error.

- [ ] **Step 3: Register the tool in `src/index.ts`**

Import `registerVaultSearchTools` and call it after the existing direct search registration.

- [ ] **Step 4: Run build and tests**

Run:

```bash
npm run build
npm test
```

Expected: TypeScript compilation and all tests pass.

---

## Task 6: Add the Pi/non-MCP CLI adapter

**Files:**
- Create: `src/commands/search-vault.ts`
- Create: `bin/obsidian-agent-search`
- Modify: `package.json`
- Create: `tests/commands/search-vault.test.ts`

**Interfaces:**
- Consumes `searchVault` and `rebuildVaultIndex` from Task 3.
- Produces executable `obsidian-agent-search vault [--limit N] [--rebuild] <query>`.

- [ ] **Step 1: Write CLI parser tests**

Assert parsing of:

```ts
expect(parseArgs(["vault", "explicit vault selector"])).toEqual({
  command: "vault",
  query: "explicit vault selector",
  limit: 10,
  rebuild: false,
});
expect(parseArgs(["vault", "--limit", "5", "query", "terms"])).toMatchObject({
  limit: 5,
  query: "query terms",
});
expect(parseArgs(["vault", "--rebuild", "query"])).toMatchObject({ rebuild: true });
```

- [ ] **Step 2: Implement argument parsing and command execution**

Accept only the `vault` subcommand. Parse `--limit N` and `--rebuild`; treat remaining arguments as the query. Exit with a usage error for a missing query, invalid limit, or unknown option.

Call the shared `searchVault` function with `process.env.OBSIDIAN_VAULT` and `OBSIDIAN_DATA_DIR` defaults. Print one structured Markdown result per note with confidence and path. Print `No matching notes found.` and exit zero for an empty result set.

- [ ] **Step 3: Add the executable wrapper and package mapping**

Create `bin/obsidian-agent-search` following the existing launcher pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${OBSIDIAN_AGENT_SEARCH_EXECUTABLE:-$SCRIPT_DIR/../dist/commands/search-vault.js}" "$@"
```

Add to `package.json`:

```json
"obsidian-agent-search": "bin/obsidian-agent-search"
```

- [ ] **Step 4: Run CLI tests and smoke commands**

Run:

```bash
npm test -- tests/commands/search-vault.test.ts
npm run build
node dist/commands/search-vault.js vault --limit 1 "vault selector"
```

Expected: parser tests pass, build succeeds, and the smoke command prints either a result or `No matching notes found.` without touching `summaries.db`.

---

## Task 7: Route the agent-memory skill through semantic search

**Files:**
- Modify: `module/skills/agent-memory/SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes `obsidian_search_vault` when MCP is available and `obsidian-agent-search vault` in Pi/CLI environments.
- Produces semantic-first memory retrieval instructions with exact keyword fallback.

- [ ] **Step 1: Update the skill retrieval procedure**

Replace the current first lookup step with explicit routing:

1. Use `obsidian_search_vault` with the memory query when MCP tools are available.
2. Otherwise run `obsidian-agent-search vault` with the same query and explicit `OBSIDIAN_VAULT`/`OBSIDIAN_DATA_DIR` configuration.
3. Prefer `confirmed` results.
4. If no confirmed result exists, use `semantic` results as lower-confidence candidates.
5. Read the complete selected Markdown note through the existing MCP/CLI read operation.
6. If semantic search/indexing is unavailable, fall back to targeted keyword search in `3_Resource/agent memory/`.

Preserve the existing rules for active status, confidence, scope, backlinks, and read-back verification. Do not make `obsidian_session(seed)` the primary memory lookup.

- [ ] **Step 2: Document operational behavior**

In `README.md`, document:

- `vault-index.db` location and rebuildability
- fixed `nomic-embed-text` requirement for semantic results
- keyword fallback when Ollama is unavailable
- `obsidian_search_vault` and `obsidian-agent-search vault`
- `obsidian-agent-search vault --rebuild`
- separation and deprecation of `summaries.db`

- [ ] **Step 3: Run documentation and source checks**

Run:

```bash
rg -n "obsidian_search_vault|obsidian-agent-search|vault-index.db|summaries.db" README.md module/skills/agent-memory/SKILL.md
npm run build
npm test
```

Expected: both interfaces and fallback behavior are documented, build succeeds, and all tests pass.

---

## Task 8: Add end-to-end rebuild and legacy-isolation verification

**Files:**
- Modify: `tests/search/vault-search.test.ts`
- Modify: `tests/search/vault-indexer.test.ts`
- Modify: `scripts/smoke-test-local.sh`
- Modify: `README.md`

**Interfaces:**
- Consumes all completed index, search, MCP, CLI, and skill behavior.
- Produces a repeatable local verification path for a fresh database.

- [ ] **Step 1: Add fresh rebuild integration test**

Create a temporary vault containing an ordinary note and `4_Archive/_agent_sessions/2026-01-01.md`. Call `searchVault({ query: "session summary", vaultPath, dataDir, rebuild: true, embed: deterministicEmbed })`, where `deterministicEmbed` returns a 768-element vector. Assert that the result paths include both Markdown files and that `vault-index.db` exists.

- [ ] **Step 2: Add legacy isolation assertions**

Set `OBSIDIAN_DATA_DIR` to a temporary directory, create a sentinel `summaries.db` file, run rebuild and search, and assert:

```ts
expect(existsSync(join(dataDir, "summaries.db"))).toBe(true);
expect(readFileSync(join(dataDir, "summaries.db"))).toEqual(sentinel);
expect(existsSync(join(dataDir, "vault-index.db"))).toBe(true);
```

- [ ] **Step 3: Extend the local smoke script**

Add a temporary-vault smoke path that builds the project, runs `obsidian-agent-search vault --rebuild`, runs a semantic query with the local Ollama model when available, and verifies the output contains a vault-relative Markdown path. If Ollama is unavailable, verify the keyword fallback output instead of failing the script.

- [ ] **Step 4: Run the release checks**

Run:

```bash
npm run build
npm test
bash scripts/smoke-test-local.sh
```

Expected: build, unit/integration tests, fresh rebuild, semantic/keyword routing, and legacy isolation all pass.

---

## Completion checklist

- [ ] `vault-index.db` is created outside the vault and contains all Markdown-note indexes.
- [ ] Lazy synchronization handles additions, changes, deletions, unchanged notes, and embedding failures.
- [ ] Semantic retrieval precedes candidate-scoped keyword confirmation.
- [ ] Confirmed results rank before lower-confidence semantic-only results.
- [ ] Ollama failure preserves FTS search.
- [ ] Session summaries are indexed from Markdown and no longer written directly to `summaries.db`.
- [ ] MCP and CLI adapters use the same protocol-neutral search function.
- [ ] Agent-memory uses semantic-first retrieval in MCP and Pi/CLI environments.
- [ ] Rebuild behavior and legacy database isolation are tested.
- [ ] README and skill documentation match the implemented interfaces.
