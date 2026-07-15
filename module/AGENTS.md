# Obsidian Agent Memory

Use the `agent-memory` skill on every task. Retrieve relevant active memories before work and autonomously capture explicit corrections and reusable failures without approval prompts.

Use `obsidian-agent-tools` MCP tools when they are available. In Pi, or any runtime without MCP, use the Obsidian CLI through `Bash` with `OBSIDIAN_VAULT_NAME`, `OBSIDIAN_VAULT`/`OBSIDIAN_VAULT_PATH`, and `OBSIDIAN_CLI_PATH`. Always pass the registered vault name explicitly and read notes back after writes before claiming success. Never store secrets or sensitive data, and never bypass the Obsidian CLI with raw filesystem writes.
