# Memory writes and lifecycle

Prefer the Obsidian MCP write tools. In runtimes without MCP, follow
[obsidian-cli.md](obsidian-cli.md). After every create, append, or lifecycle
update, read the exact target note back through the same backend and verify a
stable heading or content marker before reporting success. Never delete memory
automatically.

Lifecycle states:

- `superseded`: newer guidance replaces the memory; link the replacement.
- `needs-review`: validity is uncertain after a tool/repository change or
  contradictory evidence.
- `retired`: no longer useful but retained for provenance.

Exclude inactive memories from routine guidance.

If MCP is unavailable, retry through the explicitly selected Obsidian CLI. If
the CLI or configured vault is unavailable, or verification fails, continue the
task without claiming a successful write. Mention the failure briefly only when
memory should have been captured or retrieved.

Never write directly to the vault filesystem as a fallback. Redact secrets from
errors and avoid copying confidential third-party information. Prefer a compact,
general reusable rule and a source link over transcript content.
