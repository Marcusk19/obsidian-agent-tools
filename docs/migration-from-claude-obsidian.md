# Migration from claude-obsidian

`obsidian-agent-tools` is the generalized successor to `claude-obsidian`.

1. Install/build the new package.
2. Set `OBSIDIAN_VAULT` to the vault path.
3. Register the new MCP server command.
4. Configure the Claude Code hook and/or Pi extension.
5. Install Ollama and `qwen2.5:7b`.

The old repository is archived rather than maintained as a compatibility package. The new project intentionally uses neutral names and does not support the old package name or `OBSIDIAN_VAULT_PATH` as a public compatibility alias.

Historical session files are not migrated automatically:

- `4_Archive/_claude_sessions` remains unchanged.
- `4_Archive/_pi_sessions` remains unchanged.
- New entries are written to `4_Archive/_agent_sessions`.
