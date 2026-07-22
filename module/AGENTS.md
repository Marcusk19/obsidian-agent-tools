# Obsidian Agent Memory

Automatic pre-turn memory injection satisfies the start-of-task retrieval requirement. Do not load the `agent-memory` skill or repeat the search unless exact source details are needed, the injected context is insufficient, the user asks about history/notes/prior decisions, or a correction, durable preference, or reusable failure must be captured. Injected snippets are advisory; canonical Markdown remains authoritative.

Use `obsidian-agent-tools` MCP tools when they are available. In Pi, or any runtime without MCP, use the Obsidian CLI through `Bash` with `OBSIDIAN_VAULT_NAME`, `OBSIDIAN_VAULT`/`OBSIDIAN_VAULT_PATH`, and `OBSIDIAN_CLI_PATH`. Always pass the registered vault name explicitly and read notes back after writes before claiming success. Never store secrets or sensitive data, and never bypass the Obsidian CLI with raw filesystem writes.
