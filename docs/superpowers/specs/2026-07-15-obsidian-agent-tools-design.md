# Obsidian Agent Tools: Cross-Harness Notebook Integration

## Status

Design approved in conversation; implementation has not started.

## Goal

Create a new generalized project named `obsidian-agent-tools` that carries Obsidian notebook functionality across agent harnesses. The first supported harnesses are Claude Code and Pi.

The project must provide:

- Shared interactive Obsidian notebook functionality through MCP.
- Shared session summarization behavior for Claude Code and Pi.
- One common session-summary location: `_agent_sessions`.
- One common summary format, based on Pi's current concise handoff style.
- A local-only summarization path using Ollama and `qwen2.5:7b`.

The current `claude-obsidian` GitHub repository will be archived. A new repository will be created from the implementation, with clean generalized package naming and documentation. Existing `_claude_sessions` and `_pi_sessions` files remain untouched and are not migrated automatically.

## Product boundary

The new repository is a cross-harness Obsidian integration, not a Claude-specific plugin.

MCP is the portable mechanism for interactive notebook functionality. MCP does not provide reliable session lifecycle events, so each harness has a thin lifecycle adapter. A shared core and CLI own all behavior that must remain identical across runtimes.

```text
MCP client -> MCP adapter -> Obsidian vault functionality

Claude Code SessionEnd -> Claude adapter -\
                                           -> shared summarizer/core -> _agent_sessions
Pi session_shutdown   -> Pi adapter ------/
```

## Project structure

The generalized project should organize responsibilities approximately as follows:

```text
src/
  core/
    config.ts             # vault, data, and Ollama configuration
    session-format.ts     # normalized input and Markdown output contract
    session-writer.ts     # _agent_sessions writer and locking
    summarizer.ts         # Ollama client and prompt
  db/
    ...                   # searchable summary index
  tools/
    ...                   # MCP vault/session tools
  adapters/
    claude-code/
      session-end.ts      # Claude hook input adapter
    pi/
      ...                 # Pi input adapter support
  cli.ts                  # MCP server entry point
  summarizer/
    index.ts              # shared summarizer CLI entry point

integrations/
  claude-code/
    on-session-end        # Claude Code hook
    on-post-compact       # optional compact-event hook
  pi/
    obsidian-agent-tools.ts # Pi extension

bin/
  obsidian-agent-summarize # documented shared summarizer executable
```

The exact file layout may vary during implementation, but the boundaries are required:

- Core owns configuration, normalization contract, summarization, formatting, persistence, locking, and indexing.
- MCP tools own interactive vault operations.
- Claude Code and Pi adapters only collect and normalize runtime-specific session data.
- Adapters must not contain independent prompts, model clients, parsers, or Markdown writers.

## Existing functionality

The new repository migrates all current MCP functionality before or alongside the cross-harness changes:

- Vault information.
- Note read, write, move, rename, and delete operations.
- Search.
- Graph navigation.
- Tags, aliases, and properties.
- Tasks and task updates.
- Session context and morning workflows.
- Session-summary search and SQLite indexing.

The public package, README, configuration, log names, and internal terminology must be generalized. The new project does not preserve the old package name or old public compatibility aliases. The archived repository receives a migration notice pointing to `obsidian-agent-tools`.

## Configuration

Canonical new configuration includes:

```text
OBSIDIAN_VAULT                 # absolute vault path
OLLAMA_HOST=http://127.0.0.1:11434
OBSIDIAN_SUMMARY_MODEL=qwen2.5:7b
```

The new project should use neutral names throughout. Existing Claude-specific variables are not part of the new public compatibility contract.

The MCP server and lifecycle summarizer share the vault configuration, but remain independently executable integration surfaces.

## Shared session input contract

Both adapters produce a normalized JSON payload:

```json
{
  "runtime": "claude-code",
  "session_id": "session-id",
  "transcript": "[user]: ...\\n\\n[assistant]: ...",
  "cwd": "/Users/example/workspace/project"
}
```

Required behavior:

- Validate all required fields.
- Apply the existing minimum session-size filter.
- Apply one consistent maximum transcript size and truncation marker.
- Preserve runtime and session ID metadata for the output file and search index.

## Local summarization

The shared summarizer uses Ollama rather than Vertex AI or another remote provider.

Default model:

```text
qwen2.5:7b
```

The model name and Ollama endpoint are configurable. When the model is unavailable, the summarizer attempts to pull it automatically with Ollama. If Ollama cannot be reached or the pull fails, the session is not summarized and a clear error is logged. Transcripts must not be sent to a remote fallback provider.

The summarization prompt is shared by both runtimes. It requires:

- A topic under 60 characters.
- A plain-prose handoff of approximately 3–6 sentences.
- Accomplishments, key decisions, current status, and next steps where explicitly supported by the transcript.
- No bullets, bold text, headers, code blocks, or speculative claims in the summary body.

The parser validates and normalizes the model response before writing.

## Shared output contract

New summaries are written to:

```text
$OBSIDIAN_VAULT/4_Archive/_agent_sessions/YYYY-MM-DD.md
```

Historical files in `_claude_sessions` and `_pi_sessions` are left in place.

The daily file uses Pi's current style as the canonical format:

```markdown
# Agent Sessions — 2026-04-01

### 10:32 — Improve session summarization

The shared summarization pipeline was designed for both Pi and Claude Code.
Both runtimes now normalize their transcripts into the same input format.
Summaries are generated locally through Ollama and stored in one directory.

**Runtime:** `pi`
**Session:** `abc123`
**CWD:** `~/workspace/project`

---
```

The writer creates the dated header when needed and inserts separators between entries. It must protect against concurrent Pi and Claude Code completions through a lock or equivalent atomic write strategy.

The Markdown file is written independently of SQLite indexing. If indexing fails, the Markdown summary remains available and the indexing error is logged separately.

## Claude Code adapter

The Claude Code integration is provided under `integrations/claude-code`.

The SessionEnd hook:

- Reads Claude Code hook JSON from stdin.
- Resolves transcript path and session metadata.
- Normalizes the transcript into the shared input contract.
- Invokes the shared summarizer in the background.
- Returns immediately and never delays Claude Code shutdown.

The PostCompact integration may record compact events in `_agent_sessions`, but it must use the shared writer and output contract rather than directly modifying the daily note with a separate format.

## Pi adapter

The Pi integration is provided under `integrations/pi`.

The Pi extension:

- Listens for `session_shutdown`.
- Processes actual quit events and ignores reload, switch, or fork events.
- Extracts the Pi session branch.
- Normalizes it into the shared input contract.
- Invokes the shared summarizer in detached/background mode.
- Returns immediately so Pi can exit normally.

The current Pi-specific model client, prompt, parser, and writer are removed from the adapter. Pi and Claude Code invoke the same shared executable.

## Shared executable and installation

Both adapters invoke a documented executable such as:

```text
bin/obsidian-agent-summarize
```

The executable path must be configurable; no adapter may contain a hardcoded developer workspace path.

Documentation provides independent setup and verification instructions for:

1. MCP server registration.
2. Claude Code hook installation.
3. Pi extension installation/loading.
4. Ollama availability and model setup.

An optional bootstrap command may automate local installation, but manual steps remain documented for troubleshooting and transparency.

## Reliability and error handling

All lifecycle integrations are best-effort and failure-isolated:

- Missing or malformed hook input: log and exit successfully.
- Short session: skip without creating an entry.
- Ollama unavailable: attempt the configured local setup, then log and skip if unavailable.
- Model pull failure: log and skip.
- Invalid model response: attempt constrained parsing; log and skip if parsing fails.
- Concurrent writes: serialize or atomically protect the dated file.
- SQLite failure: retain the Markdown output and report indexing failure separately.
- Adapter failure: never fail or block the agent runtime's shutdown.

## Testing

The project should include:

- Unit tests for Claude Code and Pi transcript normalization.
- Unit tests for minimum-length filtering and transcript truncation.
- Unit tests for Ollama response parsing and malformed responses.
- Unit tests proving identical Markdown output for equivalent inputs from both runtimes.
- Tests for metadata escaping and CWD shortening.
- Tests for repeated and concurrent appends.
- Integration tests using a fake Ollama HTTP server.
- Fixture tests for representative Claude Code and Pi session payloads.
- A manual smoke-test script covering MCP startup, Claude hook invocation, Pi extension invocation, shared output, and searchable indexing.

Tests must not require a live Ollama model or network access. Live model behavior is covered by a documented smoke-test command.

## Migration and release

The current repository is the design and implementation source for the new project, but the public product transition is explicit:

1. Implement and verify the generalized project.
2. Create the `obsidian-agent-tools` repository with clean package naming and documentation.
3. Archive the old GitHub repository.
4. Add a migration notice in the archived repository pointing to the new project.
5. Do not automatically move or copy existing `_claude_sessions` and `_pi_sessions` files.

## Non-goals

- No remote summarization fallback.
- No automatic migration of historical session directories.
- No requirement to preserve old package names or old environment-variable aliases.
- No attempt to make MCP itself provide lifecycle hooks.
- No separate summarization implementation per runtime.
