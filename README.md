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

## Tools

### Read-only

| Tool | Description |
|------|-------------|
| `obsidian_vault_info` | Vault overview, file/folder listing, recents, bookmarks |
| `obsidian_read` | Read note contents, daily note, file info, outline |
| `obsidian_search` | Full-text search with optional line context |
| `obsidian_graph` | Backlinks, outgoing links, orphans, dead-ends, unresolved links |
| `obsidian_tags` | List all tags or get info about a specific tag |
| `obsidian_properties` | List properties or read a property value |
| `obsidian_tasks` | List tasks, filter by status/file/daily note |
| `obsidian_aliases` | List aliases in the vault |

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

## Verify

After registering, run `/mcp` in Claude Code to confirm the server is connected and all 12 tools are available.

## Uninstall

```bash
claude mcp remove obsidian -s user
```

## License

MIT
