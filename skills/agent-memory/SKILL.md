---
name: agent-memory
description: >-
  Maintain durable, reusable agent memories in the user's Obsidian vault. The
  automatic pre-turn context hook satisfies routine retrieval; load this skill
  for deeper retrieval, exact source reads, or memory capture and maintenance.
user-invocable: false
allowed-tools:
  - Bash
  - mcp__obsidian__obsidian_search
  - mcp__obsidian__obsidian_read
  - mcp__obsidian__obsidian_write
  - mcp__obsidian__obsidian_graph
  - mcp__obsidian__obsidian_property_write
  - mcp__obsidian__obsidian_properties
  - mcp__obsidian__obsidian_vault_info
---

# Agent Memory

Keep durable guidance small, scoped, trustworthy, and stored as canonical
Markdown in the Obsidian vault. Memory is not a transcript, task log, project
note, or scratchpad.

## Hot path

Automatic pre-turn memory injection satisfies routine start-of-task retrieval.
Do not repeat that search merely because this skill is available.

- Apply injected guidance only within its recorded scope.
- A compact `## Rule` excerpt is sufficient for low-risk behavioral guidance.
- Read the complete source when exact commands, exceptions, conflicts, rationale,
  or a consequential action depends on it.
- Perform deeper retrieval only when injected context is absent or insufficient,
  or when the user asks about history, notes, plans, or prior decisions.
- Capture explicit corrections, durable preferences, and reusable failures
  autonomously; do not ask for approval.
- Never store credentials, secrets, sensitive personal data, or raw transcripts.

## Load detailed instructions only when needed

- Deeper/manual retrieval: [references/retrieval.md](references/retrieval.md)
- Capture criteria and duplicate handling: [references/capture.md](references/capture.md)
- Memory and project-memory formats: [references/formats.md](references/formats.md)
- Writes, lifecycle, and verification: [references/lifecycle.md](references/lifecycle.md)
- Pi/CLI fallback commands: [references/obsidian-cli.md](references/obsidian-cli.md)

After creating or materially updating a memory, mention its wikilink briefly in
the ordinary response. Routine retrieval remains invisible.
