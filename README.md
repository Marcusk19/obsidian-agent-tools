# claude-obsidian

An MCP server that gives [Claude Code](https://docs.anthropic.com/en/docs/claude-code) full access to your [Obsidian](https://obsidian.md) vault through Obsidian's built-in CLI.

Claude can read notes, search your vault, navigate the graph, manage tasks, edit properties, create and modify notes — all without leaving the terminal.

## Prerequisites

- **Obsidian** with CLI support (v1.8+, macOS). The CLI binary lives at `/Applications/Obsidian.app/Contents/MacOS/obsidian`.
- **Obsidian must be running** — the CLI communicates with the running app.
- **Node.js** v18+
- **Claude Code** installed

## Install

### Via npx (recommended)

No clone or build needed:

```bash
claude mcp add obsidian -s user \
  -e OBSIDIAN_VAULT_PATH=/path/to/your/vault \
  -e OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian \
  -- npx -y claude-obsidian
```

### From source

```bash
git clone https://github.com/Marcusk19/claude-obsidian.git
cd claude-obsidian
npm install
npm run build

claude mcp add obsidian -s user \
  -e OBSIDIAN_VAULT_PATH=/path/to/your/vault \
  -e OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian \
  -- node /absolute/path/to/claude-obsidian/dist/index.js
```

Restart Claude Code to pick up the new server.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT_PATH` | `/Users/mkok/obsidian-git-sync` | Absolute path to your Obsidian vault |
| `OBSIDIAN_CLI_PATH` | `/Applications/Obsidian.app/Contents/MacOS/obsidian` | Path to the Obsidian CLI binary |
| `OBSIDIAN_SESSIONS_FILE` | `claude-sessions.md` | Vault-relative path to the session tracking file read by `obsidian_session context` |

## Tools

### Read-only

| Tool | Description |
|------|-------------|
| `obsidian_vault_info` | Vault overview, file/folder listing, recents, bookmarks |
| `obsidian_read` | Read note contents, daily note, file info, or outline. Includes `daily:recent` for fetching the last N daily notes |
| `obsidian_search` | Full-text search with optional line context |
| `obsidian_graph` | Backlinks, outgoing links, orphans, dead-ends, unresolved links |
| `obsidian_tags` | List all tags or get info about a specific tag |
| `obsidian_properties` | List properties or read a property value |
| `obsidian_tasks` | List tasks, filter by status/file/daily note |
| `obsidian_aliases` | List aliases in the vault |
| `obsidian_session` | Session orchestration: `context` (start-of-session briefing) and `morning` (daily kickoff agenda) |

### Destructive

These tools require confirmation before Claude executes them.

| Tool | Description |
|------|-------------|
| `obsidian_write` | Create notes, append/prepend to notes or daily notes |
| `obsidian_manage` | Move, rename, or delete notes |
| `obsidian_property_write` | Set or remove properties on notes |
| `obsidian_task_update` | Toggle, complete, or uncomplete tasks |

## Usage examples

Once registered, just ask Claude naturally:

- *"What's in my daily note?"*
- *"Search my vault for kubernetes"*
- *"Show me all incomplete tasks"*
- *"Append 'Review PR #42' to today's daily note"*
- *"What notes link to my Konflux project note?"*
- *"List all tags sorted by count"*

### Session workflows

These workflows require no CLAUDE.md configuration — the tool descriptions teach Claude when to invoke them automatically.

**Start of session** — say *"catch me up"*, *"what are we working on?"*, or *"start work"*:

Claude calls `obsidian_session context`, which returns in one shot:
- Contents of your sessions file (`claude-sessions.md` by default)
- All open tasks
- Today's daily note

**Morning kickoff** — say *"morning briefing"*, *"start my day"*, or *"daily kickoff"*:

Claude calls `obsidian_session morning`, which returns:
- Last 3 daily notes for recent context
- All open tasks
- Your projects index (`1_Projects/index.md`) if it exists

**Session handoff** — at the end of a session, ask Claude to write a handoff note:

Claude uses `obsidian_write daily:append` to append a summary to today's daily note, and `obsidian_write create` to update `claude-sessions.md`. Recommended template:

```markdown
## Session handoff — 2026-03-08

### What we did
- ...

### Open threads
- [ ] ...

### Next steps
- ...
```

**Reading recent context** — ask Claude for the last few days of notes:

Claude calls `obsidian_read` with `action=daily:recent, days=3`.

## Verify

After registering, run `/mcp` in Claude Code to confirm the server is connected and all 14 tools are available.

## Uninstall

```bash
claude mcp remove obsidian -s user
```

## License

MIT
