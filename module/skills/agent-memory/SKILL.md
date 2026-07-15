---
name: agent-memory
description: >-
  Maintain durable, reusable agent memories in the user's Obsidian vault. Use
  automatically on every task to retrieve relevant guidance and to capture
  explicit corrections, confirmed preferences, and reusable failures without
  approval prompts. Use for agent memory, corrections, recurring problems, and
  learned workarounds.
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

Maintain a small, trustworthy store of durable guidance in the Obsidian vault.
This is not a transcript, task log, project note, or scratchpad.

## Memory location

Store memories as individual Markdown files under:

```text
3_Resource/agent memory/
```

Use stable semantic filenames:

- `Correction - <short rule>.md`
- `Preference - <short preference>.md`
- `Recurring problem - <short problem>.md`

Do not put dates in filenames. Dates belong in frontmatter so links remain stable
when a memory is reinforced.

## Always-on behavior

At the start of a task:

1. Identify the relevant repository, project, tools, domain concepts, and user preferences.
2. Search `3_Resource/agent memory/` for active memories matching those concepts. Prefer `mcp__obsidian__obsidian_search` when available; otherwise use the Obsidian CLI fallback below.
3. Read the most relevant results, prioritizing `confidence: confirmed` over `provisional`. Prefer `mcp__obsidian__obsidian_read`; otherwise use the CLI `read` command.
4. Use `mcp__obsidian__obsidian_graph` or the CLI `backlinks`/`links` commands to inspect related context for high-relevance memories when useful.
5. Apply memories only within their recorded scope. A repository-specific workaround must not become a global rule.

Do not load every memory at every session. Keep retrieval targeted and bounded. Do
not use `obsidian_session(seed)` as the primary memory lookup: it searches the
whole vault and seeds from one top result. It may be used for broader topic context
after memory search, not instead of it.

## When to capture a memory

Capture memories autonomously. Do not ask the user to invoke a memory command and
do not ask for approval before writing.

### Confirmed corrections

Create or update a `type: correction` memory immediately when the user clearly
provides a replacement rule, for example:

- "That's wrong; the correct command is ..."
- "Don't use X here; use Y."
- "In this repository, the convention is ..."

A clear correction is `confidence: confirmed`. Ordinary disagreement, tentative
language, brainstorming, or the agent changing its own plan is not a correction.

### Preferences

Create a `type: preference` memory when the user explicitly states a durable
preference. Do not infer a personal preference from a single choice unless it is
clearly intended as a reusable rule.

### Reusable failures

Create a `type: recurring-problem` memory when a failure reveals a behavior-changing
rule that is likely to recur. A strong single-incident lesson may be written as
`confidence: provisional`. Promote it to `confirmed` when it recurs, a workaround
is successfully validated, repository documentation confirms it, or the user
confirms the explanation.

Ignore incidental failures such as transient network errors, typos, or isolated
non-zero exits that do not reveal a reusable constraint.

## Search before writing

Before creating a memory:

1. Search the memory folder for the proposed rule, its key terms, the tool or repository, and likely synonyms.
2. Read close matches and inspect their status, scope, and confidence.
3. Update an existing memory when it expresses the same rule.
4. If new evidence contradicts an active memory, do not leave competing active rules. Update the old memory when it is clearly the same concept, or mark it `status: superseded` and create a linked replacement when the distinction matters.
5. Update `last_confirmed` when confirmed evidence reinforces an existing memory.

## Memory format

Every memory should use this shape:

```markdown
---
type: correction
status: active
confidence: confirmed
scope:
  - repository: example/repository
topics:
  - "[[Example topic]]"
tags:
  - agent-memory
  - agent-memory/correction
created: 2026-04-07
last_confirmed: 2026-04-07
source: "[[Source note]]"
---
# Use the repository's documented test command

## Rule

State the reusable guidance directly and unambiguously.

## Why

Explain the evidence or consequence briefly.

## Evidence

Describe the correction, failure, validation, or documentation that supports it.
Do not copy a whole transcript.

## Applies when

State the task, repository, tool, or situation where this rule applies.
```

Allowed values:

- `type`: `correction`, `preference`, `recurring-problem`
- `status`: `active`, `superseded`, `retired`, `needs-review`
- `confidence`: `confirmed`, `provisional`
- `scope`: `global`, `tool:<name>`, `repository:<name>`, `project:<name>`, or `topic:<name>`

Use the narrowest scope supported by the evidence. A local lesson can later be
promoted only after evidence shows it applies more broadly.

Use meaningful wikilinks for topics, repositories, projects, source notes, related
memories, and replacements. Link to existing notes when possible. Unresolved links
are acceptable; do not create placeholder topic notes solely to increase graph
connectivity.

## Updating and lifecycle

Prefer `mcp__obsidian__obsidian_write` for note creation or content updates and
`mcp__obsidian__obsidian_property_write` for small lifecycle-property changes. When
MCP is unavailable, use the Obsidian CLI fallback below. After every create,
append, or lifecycle update, read the target note back through the same backend and
verify the expected title or stable content marker before reporting success. Never
delete a memory automatically.

When a memory becomes invalid:

- mark it `superseded` and link the replacement when newer guidance replaces it;
- mark it `needs-review` when its validity is uncertain, such as after a tool or repository version change;
- mark it `retired` when it is no longer useful but worth preserving historically;
- exclude inactive memories from normal guidance, while retaining them for provenance.

## Obsidian CLI fallback

Pi does not use MCP servers. When the Obsidian MCP tools are unavailable, use the
Obsidian CLI through `Bash` for the same operations.

The CLI's `vault=` option requires the **registered vault name**. A filesystem path
and `cd` do not select a vault, especially when multiple vaults are registered.
Keep the vault name and path distinct:

```bash
OBSIDIAN_CLI="${OBSIDIAN_CLI_PATH:-/Applications/Obsidian.app/Contents/MacOS/obsidian}"
OBSIDIAN_VAULT_NAME="${OBSIDIAN_VAULT_NAME:-obsidian-git-sync}"
OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-${OBSIDIAN_VAULT:-$HOME/obsidian-git-sync}}"
```

`OBSIDIAN_VAULT_NAME` must match the name shown by `"$OBSIDIAN_CLI" vaults`.
`OBSIDIAN_VAULT_PATH` is only the filesystem location and is not a substitute for
`vault=`. Before memory operations, list registered vaults and fail clearly if
`OBSIDIAN_VAULT_NAME` is not present. Never silently use the active vault.

Every CLI operation must include `vault="$OBSIDIAN_VAULT_NAME"`:

- Search: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" search query="..." path="3_Resource/agent memory/"`
- Read: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" read path="3_Resource/agent memory/<file>.md"`
- Backlinks: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" backlinks path="3_Resource/agent memory/<file>.md"`
- Outgoing links: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" links path="3_Resource/agent memory/<file>.md"`
- Create: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" create path="..." content="..." overwrite`
- Append: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" append path="..." content="..."`
- Lifecycle property: `"$OBSIDIAN_CLI" vault="$OBSIDIAN_VAULT_NAME" property:set path="..." name=status value=superseded`

Quote paths and content safely. For multiline note creation or updates, use a
shell variable or a short Python helper to pass one properly escaped `content=`
argument to the CLI; do not bypass the CLI by writing directly to the vault.

After every create, append, or `property:set`, read the exact target path back
with the same explicit `vault=` selector. Confirm the read succeeds and contains
the expected heading or a stable marker from the written content. Do not redirect
CLI diagnostics to `/dev/null` before verification, and do not report success based
only on process exit status. If verification fails, report the write as unverified
or failed and include the CLI diagnostic.

If an MCP call fails because the server is unavailable, retry the same operation
through this explicitly-selected CLI fallback before giving up. Do not require the
user to configure MCP in Pi.

## Privacy and content boundaries

Never store passwords, API keys, access tokens, private keys, session cookies, or
other credentials. Redact secrets from error output. Do not copy sensitive personal
or confidential third-party information. Prefer a generalized reusable rule and a
link to the source note over copied transcript content.

## User visibility

Memory retrieval should normally be invisible. After creating or materially updating
a memory, include a concise note in the ordinary response, for example:

> Captured reusable guidance in `[[Correction - ...]]`.

Do not show every search result, confidence calculation, or routine memory read.
Do not interrupt work with an approval question.

## Failure handling

If the preferred MCP operation is unavailable, use the explicitly-selected
Obsidian CLI fallback. If the configured vault name is not registered, the CLI is
unavailable, or read-back verification fails, continue the task without inventing
a successful write. Mention the unavailable or unverified memory operation briefly
only if a memory should have been captured or retrieved. Never fall back to raw
shell writes; the fallback must remain an Obsidian CLI operation.
