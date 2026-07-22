# Memory formats

## Durable memory

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
Summarize the correction, validation, failure, or documentation.

## Applies when
State the task, repository, tool, or situation.
```

Allowed values:

- `type`: `correction`, `preference`, `recurring-problem`, `project-memory`
- `status`: `active`, `superseded`, `retired`, `needs-review`
- `confidence`: `confirmed`, `provisional`
- `scope`: `global`, `tool:<name>`, `repository:<name>`, `project:<name>`, or
  `topic:<name>`

Use the narrowest supported scope. Use meaningful wikilinks to existing topics,
repositories, projects, sources, related memories, and replacements. Do not
create placeholder notes solely for graph connectivity.

## Project memory

```markdown
---
type: project-memory
status: active
project: example-project
repository: example/repository
created: 2026-04-07
last_updated: 2026-04-07
tags:
  - agent-memory
  - agent-memory/project
---
# Example Project

## Purpose
## Durable context
## Decisions
## Conventions
## Current state
## Open questions
## Next steps
```

The repository field is optional for non-repository workstreams. During explicit
handover, merge facts into the living sections, preserve settled decisions,
refresh state and next steps, and remove resolved or stale items. Never append a
full transcript.
