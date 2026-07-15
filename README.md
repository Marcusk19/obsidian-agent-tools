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
| `OBSIDIAN_VAULT` | `$HOME/obsidian-git-sync` | Absolute Obsidian vault path |
| `OBSIDIAN_DATA_DIR` | `$HOME/.local/share/obsidian-agent-tools` | SQLite database and summarizer logs |
| `OBSIDIAN_CLI_PATH` | `/Applications/Obsidian.app/Contents/MacOS/obsidian` | Obsidian CLI binary |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `OBSIDIAN_SUMMARY_MODEL` | `qwen2.5:7b` | Local model used for session summaries |
| `OBSIDIAN_AGENT_SUMMARIZER` | repository launcher | Override the shared summarizer executable |

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

The skill prefers the `obsidian-agent-tools` MCP server when available. In Pi, where MCP is not used, it falls back to the Obsidian CLI through `Bash`. Set `OBSIDIAN_VAULT` and, when necessary, `OBSIDIAN_CLI_PATH` for the CLI fallback.

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

The module contains the skill at `module/skills/agent-memory/SKILL.md` and the
always-on instructions at `module/AGENTS.md`. `--append-context` installs the
module instructions without replacing the rest of the assistant's global context.
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
cp module/skills/agent-memory/SKILL.md ~/.agents/skills/agent-memory/SKILL.md
```

Pi will use the CLI fallback documented in the skill because no MCP server is
required.

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

Configure the SessionEnd hook to invoke `integrations/claude-code/on-session-end`. The hook reads Claude's hook JSON, normalizes the transcript, and launches the shared summarizer without blocking shutdown. The PostCompact hook is available at `integrations/claude-code/on-post-compact`.

Set `OBSIDIAN_AGENT_SUMMARIZER` to the absolute path of `bin/obsidian-agent-summarize` when the hook is installed outside this checkout.

### Pi

Load `integrations/pi/obsidian-agent-tools.ts` as a Pi extension. Set `OBSIDIAN_AGENT_SUMMARIZER` to the absolute path of `bin/obsidian-agent-summarize`, then start Pi with the extension enabled. The extension summarizes only actual quit events and runs the shared process detached.

## Search

Summaries are also indexed in SQLite under `OBSIDIAN_DATA_DIR`. Keyword and semantic search use the local Ollama embedding model when available; Markdown output is preserved even if indexing or embeddings fail.

## Migration from claude-obsidian

This project is the generalized successor to `claude-obsidian`. The old repository is being archived. There are no old package-name or old environment-variable compatibility aliases in this project. Existing `_claude_sessions` and `_pi_sessions` directories are not moved or copied.

## License

MIT
