# Vault Semantic Index and Search Routing Design

## Status

Design approved conversationally; written spec pending user review.

## Context

`obsidian-agent-tools` currently maintains `summaries.db`, which indexes generated session summaries using FTS5 and sqlite-vec. The embedding model is Ollama's fixed `nomic-embed-text` model. Normal vault search uses the Obsidian CLI/MCP keyword search path, and the `agent-memory` skill retrieves memories through targeted keyword search.

The desired behavior is to semantically search the whole Obsidian vault first, then use targeted keyword search to confirm and narrow the semantic candidates. The whole vault includes ordinary Markdown notes as well as generated session-summary notes.

## Goals

- Create a dedicated `vault-index.db` for all Markdown notes in the configured vault.
- Include generated session-summary notes in the same index as every other Markdown note.
- Keep Markdown files as the authoritative source of truth.
- Refresh the index lazily during search without requiring a background watcher.
- Use fixed Ollama model `nomic-embed-text` for note embeddings.
- Route `agent-memory` retrieval through semantic search first and targeted keyword confirmation second.
- Preserve useful semantic-only results when exact keyword confirmation fails, while labeling them lower confidence.
- Continue to work when Ollama or semantic indexing is unavailable.
- Make the index rebuildable derived state.

## Non-goals

- Migrating records from `summaries.db` into `vault-index.db`.
- Indexing non-Markdown vault files.
- Supporting configurable embedding models in this change.
- Replacing direct exact search (`obsidian_search`) for users who explicitly request keyword search.
- Adding a long-running filesystem watcher.

## Architecture

### Storage

Create:

```text
$OBSIDIAN_DATA_DIR/vault-index.db
```

The database is separate from `summaries.db`. It contains note-specific metadata/content, an FTS5 keyword index, a sqlite-vec vector table, and schema/model metadata.

The note metadata record includes at least:

- vault-relative path
- content
- content hash
- modification time
- title or other lightweight metadata needed for results
- embedding status, last error, and last attempt time for bounded retry behavior

The FTS5 table indexes note title and content. The vector table stores 768-dimensional `nomic-embed-text` vectors and enough note identity/metadata to return search results. Mapping tables must permit safe replacement and deletion of vector rows when notes change or disappear.

`vault-index.db` is local derived state and is not a source of truth. It is stored under the configured data directory, not inside the vault.

### Indexing

Before a semantic vault search:

1. Enumerate Markdown files beneath `OBSIDIAN_VAULT`.
2. Compare each file's relative path, modification time, and content hash with the index.
3. Add new notes.
4. Re-index changed notes, including FTS content and embedding.
5. Remove records for deleted notes.
6. Leave unchanged notes untouched.

The initial search may perform a full scan and embed the vault. Later searches process only new or changed notes.

Markdown files that cannot be read or parsed are logged and skipped without preventing other notes from being indexed.

### Session summaries

Session summaries are indexed by scanning their Markdown files like all other notes. The new search path does not read `summaries.db` and new summaries must not be written directly to the old session-specific index.

The initial population is a complete rebuild from vault Markdown. Existing rows in `summaries.db` are intentionally not migrated. Once the new path is validated, the old database and its write/search path can be retired or left only as an explicitly deprecated artifact.

## Search routing

### Shared search interface

Implement one protocol-neutral vault search function and expose it through:

- an MCP tool named `obsidian_search_vault`
- a CLI command named `obsidian-agent-search vault` for Pi and other non-MCP runtimes
- the internal TypeScript API used by both adapters

The existing `obsidian_search` remains the direct exact Obsidian search interface. The routed semantic-first search is a separate operation.

### Semantic-first pipeline

For a query:

1. Normalize the query.
2. Refresh the vault index lazily.
3. Generate a query embedding with `nomic-embed-text`.
4. Retrieve the top semantic candidate notes across the vault.
5. Run targeted keyword search restricted to those candidate paths.
6. Return keyword-confirmed and semantic-only result groups.

A result includes:

- vault-relative path
- title
- relevant excerpt or content
- semantic score
- whether keyword confirmation succeeded
- confidence: `confirmed` or `semantic`

Keyword-confirmed results are preferred. Semantic-only candidates remain available because conceptually relevant notes may use different wording. If no semantic results are available, the router falls back to the existing broad keyword search.

### Agent-memory integration

Update the `agent-memory` skill so memory retrieval:

1. Calls semantic vault search first.
2. Uses targeted keyword confirmation against the semantic candidate paths.
3. Prefers confirmed results.
4. Uses semantic-only results when no confirmed result exists, treating them as lower confidence.
5. Reads selected notes through the normal vault read path.
6. Falls back to broad targeted keyword search when semantic indexing or search is unavailable.

The MCP and Pi/CLI paths must provide equivalent routing semantics. The skill must not depend on MCP being present.

## Error handling and consistency

Embedding is best effort. FTS indexing succeeds when Ollama is unavailable, and notes without embeddings remain keyword-searchable. Semantic search returns available vector results and falls back to keyword search when vector search cannot run.

Embedding failure state prevents an unchanged note from being retried on every search. The implementation records failure/status information and uses a bounded retry policy; a later explicit rebuild can reattempt failed embeddings.

When replacing a changed note, the indexer must avoid leaving the note unavailable because of a partial update. A previous valid indexed version may remain until the replacement update completes successfully. Deletion should remove metadata, FTS, and vector mappings consistently.

Provide an `obsidian-agent-search vault --rebuild` operation for corruption or schema maintenance. The rebuild deletes/recreates derived index state from current vault Markdown. Embedding model changes are outside this change; the model identifier is nevertheless recorded in schema metadata for future compatibility checks.

## Testing strategy

Test the following behavior:

- new Markdown note indexing
- unchanged-note skipping
- changed-note content, FTS, and embedding replacement
- deleted-note removal
- generated session-summary note indexing
- initial rebuild from an empty database
- semantic retrieval of conceptually related notes
- targeted keyword confirmation restricted to semantic candidate paths
- confirmed versus semantic-only confidence labeling
- empty semantic result behavior
- Ollama unavailable with keyword fallback
- malformed or unreadable note isolation
- bounded handling of repeated embedding failures
- rebuild behavior
- proof that vault search does not read or write `summaries.db`
- equivalent MCP and CLI routing behavior
- agent-memory instructions and fallback behavior

## Acceptance criteria

- A fresh `vault-index.db` can be built solely from vault Markdown files.
- A semantic vault search finds relevant notes even when query and note wording differ.
- Keyword confirmation is performed only after semantic candidate selection.
- Confirmed results rank ahead of semantic-only results.
- Semantic-only results are retained and clearly labeled when confirmation finds no exact terms.
- Search remains useful without Ollama through keyword fallback.
- Session-summary notes participate in the same vault search as all other Markdown notes.
- The `agent-memory` skill uses the semantic-first route in both MCP and Pi/CLI environments.
- The old `summaries.db` is not part of the new vault search path.
