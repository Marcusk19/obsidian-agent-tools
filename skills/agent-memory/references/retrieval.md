# Memory retrieval

Use this only when automatic injected context is absent or insufficient, exact
source details matter, or the user explicitly asks about history or notes.

## Tiered retrieval

1. Identify the repository/project, tools, concepts, and likely scopes.
2. Search `3_Resource/agent memory/` with one or two targeted queries of 1–3
   terms. Prefer active, confirmed, narrowly scoped memories.
3. For repository work, search only the matching note under `1_Projects/` and
   relevant repository documentation. Do not search every project note.
4. Search recent daily notes or the wider vault only for explicit recall intent
   such as history, current plans, previous decisions, or “check my notes.”
5. Read a complete source note only when its exact details, exceptions, evidence,
   or conflicts affect the task.

Use semantic search to locate differently worded candidates and lexical/exact
search for commands, paths, Jira keys, versions, and errors. If a first query
misses, try a shorter or differently angled query rather than one long query.

Markdown is authoritative; `$OBSIDIAN_DATA_DIR/vault-index.db` is disposable
retrieval state. Never load the whole vault or use `obsidian_session(seed)` as the
primary memory lookup.

Apply guidance only within its scope. Prefer current project documentation for
project facts while preserving confirmed behavioral preferences unless they were
explicitly superseded. Surface unresolved contradictions.

For handover, search and read the matching `1_Projects/` note before consolidating.
Infer a repository-backed project from the repository name and ask only when the
target is genuinely ambiguous.
