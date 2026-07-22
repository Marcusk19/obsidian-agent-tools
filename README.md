# obsidian-agent-tools

Cross-harness tools for using an Obsidian vault from agent runtimes. The package provides an MCP server for notebook operations and shared local session summarization for Claude Code and Pi.

## Prerequisites

- Obsidian with CLI support (v1.8+, macOS)
- Node.js >=18
- Ollama
- Claude Code and/or Pi, if lifecycle summaries are desired

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT` | `$HOME/obsidian-git-sync` | Absolute Obsidian vault path used by the MCP server |
| `OBSIDIAN_VAULT_NAME` | `obsidian-git-sync` | Registered Obsidian CLI vault name; required for unambiguous CLI operations |
| `OBSIDIAN_VAULT_PATH` | `$OBSIDIAN_VAULT` | Optional filesystem path for CLI-local tooling; does not select the CLI vault |
| `OBSIDIAN_DATA_DIR` | `$HOME/.local/share/obsidian-agent-tools` | SQLite database and summarizer logs |
| `OBSIDIAN_CLI_PATH` | `/Applications/Obsidian.app/Contents/MacOS/obsidian` | Obsidian CLI binary |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `OBSIDIAN_SUMMARY_MODEL` | `qwen2.5:7b` | Local model used for session summaries |
| `OBSIDIAN_AGENT_SUMMARIZER` | repository launcher | Override the shared summarizer executable |
| `OBSIDIAN_MEMORY_ENABLED` | enabled | Set to `0` to disable automatic memory-context injection |
| `OBSIDIAN_MEMORY_TIMEOUT_MS` | `5000` | Maximum time Pi and Claude hooks wait for memory retrieval |
| `OBSIDIAN_MEMORY_MAX_CHARS` | `2000` | Rendered-character budget for injected memory context |
| `OBSIDIAN_MEMORY_MAX_RESULTS` | `1` | Maximum confirmed durable-memory candidate |
| `OBSIDIAN_MEMORY_PROJECT_RESULTS` | `1` | Maximum current-project candidate |
| `OBSIDIAN_MEMORY_BROAD_RESULTS` | `0` | Broad-vault candidates; set above zero to opt in for explicit recall prompts |
| `OBSIDIAN_AGENT_CONTEXT` | `$HOME/.local/bin/obsidian-agent-context` | Shared retrieval executable used by Pi and Claude hooks |

Session summaries are generated locally. Transcripts are not sent to Vertex AI or another remote provider.

## Build and test

```bash
npm install
npm run build
npm test
```

Install the local model once, or let the summarizer pull it when the first session ends:

```bash
ollama pull qwen2.5:7b
```

## MCP server

Register the MCP server with Claude Code or another MCP client:

```bash
npm run build
claude mcp add obsidian -s user \
  -e OBSIDIAN_VAULT=/absolute/path/to/your/vault \
  -e OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian \
  -- node /absolute/path/to/obsidian-agent-tools/dist/index.js
```

The MCP server provides vault information, note read/write/manage operations, search, graph navigation, tags, aliases, properties, tasks, session context, and searchable session summaries.

## Agent memory skill

This repository also packages the autonomous `agent-memory` skill. It stores durable corrections, preferences, and reusable failure/workaround patterns as individual notes under:

```text
$OBSIDIAN_VAULT/3_Resource/agent memory/
```

The skill prefers the `obsidian-agent-tools` MCP server when available. In Pi, where MCP is not used, it falls back to the Obsidian CLI through `Bash`. Set `OBSIDIAN_VAULT_NAME` to the registered vault name for CLI operations; `OBSIDIAN_VAULT` is the filesystem path used by the MCP server. The skill passes `vault=...` explicitly and reads notes back after every write before reporting success.

### Install with Lola

Register this repository as a Lola module, then install its skills for Claude Code at user scope:

```bash
lola mod add https://github.com/Marcusk19/obsidian-agent-tools.git \\
  --name obsidian-agent-tools
lola install obsidian-agent-tools \\
  --assistant claude-code \\
  --scope user \\
  --force \\
  --append-context module/AGENTS.md
```

The module contains a short dispatcher at
`module/skills/agent-memory/SKILL.md`, operation-specific instructions under its
`references/` directory, and always-on instructions at `module/AGENTS.md`.
Detailed capture, lifecycle, formatting, and CLI guidance is loaded only when
needed. `--append-context` installs the module instructions without replacing the
rest of the assistant's global context.
If the module was previously registered, update it before reinstalling:

```bash
lola mod update obsidian-agent-tools
lola install obsidian-agent-tools --assistant claude-code --scope user --force \\
  --append-context module/AGENTS.md
```

Lola currently lists Claude Code, Cursor, Gemini CLI, OpenClaw, and OpenCode as
installation targets; Pi is not a Lola target yet. For Pi, install the same skill
manually after cloning the repository:

```bash
mkdir -p ~/.agents/skills/agent-memory
cp -R module/skills/agent-memory/. ~/.agents/skills/agent-memory/
```

Pi will use the CLI fallback documented in the skill because no MCP server is
required.

## Automatic memory context

`obsidian-agent-context` is the single hot-path interface for memory retrieval
before each agent turn. It uses the local lexical index without waiting for
Ollama or semantic embeddings, searches active scope-matching durable memory
first, optionally checks only the project identified by `cwd`/repository
metadata, and does not search broad vault context by default. Broad search requires both an
explicit recall prompt and `OBSIDIAN_MEMORY_BROAD_RESULTS` above zero.

The command injects at most one confirmed durable rule and one scoped project
excerpt by default. Durable excerpts prefer `## Rule` plus a short `## Applies
when` summary, always include the source path, and omit internal ranking metadata.
Output stays under `OBSIDIAN_MEMORY_MAX_CHARS` (default 2,000 UTF-8 characters).
A miss returns an empty string.

```
obsidian-agent-context [--cwd PATH] [--repository NAME] [--project NAME] <prompt>
```

Automatic injection satisfies routine start-of-task memory retrieval; agents
should not load the full skill or repeat the search on every turn. The compact
rule excerpt is enough for low-risk guidance. Open the canonical source note only
when exact commands, exceptions, conflicts, rationale, or consequential actions
depend on it, or when explicit history/notes retrieval requires escalation.
Retrieval errors never block the prompt. Hooks wait up to five seconds by default;
set `OBSIDIAN_MEMORY_TIMEOUT_MS` to tune that limit. Deeper manual searches still
use semantic retrieval when available. Set
`OBSIDIAN_MEMORY_ENABLED=0` to opt out without removing the installed hooks.

### Pi

`integrations/pi/obsidian-agent-tools.ts` now invokes `obsidian-agent-context`
before each agent turn. The extension passes the turn prompt and Pi’s current
working directory to the shared executable and injects the rendered Markdown as
an invisible `customType: "obsidian-memory"` message. Override the executable
path with `OBSIDIAN_AGENT_CONTEXT` if the command is installed somewhere other
than `$HOME/.local/bin/obsidian-agent-context`.

### Claude Code

Install `integrations/claude-code/on-user-prompt-submit` as Claude Code’s
`on_user_prompt_submit` hook alongside the existing `on-session-end` and
`on-post-compact` hooks:

```
ln -sf /path/to/obsidian-agent-tools/integrations/claude-code/on-user-prompt-submit \
  "$HOME/Library/Application Support/Claude/hooks/on-user-prompt-submit"
```

The hook reads Claude’s JSON payload from stdin, launches
`obsidian-agent-context` with the prompt and `cwd`, and writes a JSON response
that preserves the original prompt plus a `system_context` field when results are
available. Claude only sees the injected Markdown; the hook does not store
prompts, retrieved context, or secrets in the vault.

## Shared session summaries

Both runtimes write new summaries to:

```text
$OBSIDIAN_VAULT/4_Archive/_agent_sessions/YYYY-MM-DD.md
```

Existing `_claude_sessions` and `_pi_sessions` files are intentionally left in place.

Entries use the same format for both runtimes:

```markdown
### 10:32 — Improve session summarization

The session summary is a concise plain-prose handoff.

**Runtime:** `pi`
**Session:** `abc123`
**CWD:** `~/workspace/project`
```

### Claude Code

Configure the SessionEnd hook to invoke `integrations/claude-code/on-session-end`. The hook reads Claude's hook JSON, normalizes the transcript, and launches the shared summarizer without blocking shutdown. The PostCompact hook is available at `integrations/claude-code/on-post-compact`, and `integrations/claude-code/on-user-prompt-submit` injects automatic memory context on `on_user_prompt_submit` before Claude runs the prompt.

Set `OBSIDIAN_AGENT_SUMMARIZER` to the absolute path of `bin/obsidian-agent-summarize` when the hook is installed outside this checkout.

### Pi

Load `integrations/pi/obsidian-agent-tools.ts` as a Pi extension. Set `OBSIDIAN_AGENT_SUMMARIZER` to the absolute path of `bin/obsidian-agent-summarize`, then start Pi with the extension enabled. The extension summarizes only actual quit events and runs the shared process detached.

## Search

The vault is semantically indexed in a disposable SQLite database at:

```text
$OBSIDIAN_DATA_DIR/vault-index.db
```

The index covers every Markdown note, including generated session summaries. Markdown files remain the source of truth and the index is refreshed lazily when searching. The fixed Ollama model `nomic-embed-text` supplies 768-dimensional embeddings.

### Set up the vault index

The index database is local derived state. It is created automatically on the first routed search and is not stored in the vault or synchronized through Git.

From a checkout of this repository:

```bash
cd /absolute/path/to/obsidian-agent-tools
pnpm install
pnpm build
pnpm add --global /absolute/path/to/obsidian-agent-tools
```

Install the embedding model in Ollama:

```bash
ollama pull nomic-embed-text
```

Set the vault and data directory when using the CLI:

```bash
export OBSIDIAN_VAULT="$HOME/obsidian-git-sync"
export OBSIDIAN_DATA_DIR="$HOME/.local/share/obsidian-agent-tools"
```

Build the initial index with a semantic search:

```bash
obsidian-agent-search vault "search your notes"
```

To discard and recreate the derived index from the current Markdown files:

```bash
obsidian-agent-search vault --rebuild "search your notes"
```

The rebuild scans all Markdown files, including `4_Archive/_agent_sessions/`. It does not migrate or modify the legacy `summaries.db`. If Ollama is unavailable, keyword indexing and search still work, but semantic results are unavailable until embeddings can be generated.

Use the semantic-first routed search through MCP:

```text
obsidian_search_vault(query="explicit vault selector")
```

Or from Pi/non-MCP runtimes:

```bash
obsidian-agent-search vault "explicit vault selector"
obsidian-agent-search vault --rebuild "explicit vault selector"
```

Routing performs semantic retrieval first, then targeted keyword confirmation. Confirmed results are preferred; semantic-only results are retained with lower confidence. If Ollama is unavailable, keyword search continues to work.

The older `summaries.db` is a legacy session-summary index and is not used by the vault search path. New session summaries are indexed from their Markdown files during the next vault search.

## Migration from claude-obsidian

This project is the generalized successor to `claude-obsidian`. The old repository is being archived. There are no old package-name or old environment-variable compatibility aliases in this project. Existing `_claude_sessions` and `_pi_sessions` directories are not moved or copied.

## License

MIT
