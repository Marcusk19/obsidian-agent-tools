# Obsidian Agent Tools Implementation Plan

> **For agentic workers:** This plan is documentation only. Do not automatically invoke implementation subskills. If the user explicitly requests execution, ask them to choose an execution skill first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the current `claude-obsidian` implementation into `obsidian-agent-tools`, preserving all MCP notebook tools while adding one local Ollama-based session summarizer shared by Claude Code and Pi, writing new summaries to `_agent_sessions`.

**Architecture:** Keep MCP as the interactive notebook interface, add a protocol-neutral session core and CLI, and make Claude Code and Pi thin lifecycle adapters that normalize their native session data into one JSON contract. The shared CLI calls Ollama, validates the result, writes a locked Markdown entry, and updates the existing SQLite/FTS/vector index.

**Tech Stack:** TypeScript 5.8+, Node.js >=18, Vitest, MCP SDK, better-sqlite3, sqlite-vec, Ollama HTTP API, Bash lifecycle hooks, Pi ExtensionAPI.

## Global Constraints

- The first supported harnesses are Claude Code and Pi.
- New summaries are written only to `$OBSIDIAN_VAULT/4_Archive/_agent_sessions/YYYY-MM-DD.md`.
- Existing `_claude_sessions` and `_pi_sessions` files remain untouched and are not migrated automatically.
- The shared summarizer uses Ollama rather than Vertex AI or another remote provider.
- The default local model is `qwen2.5:7b`.
- The default Ollama endpoint is `http://127.0.0.1:11434`.
- The canonical summary body is plain prose of approximately 3–6 sentences with no bullets, bold text, headers, code blocks, or speculative claims.
- A summary topic is under 60 characters.
- If Ollama or model installation fails, the session is skipped and a clear error is logged; there is no remote fallback.
- Lifecycle adapters must return immediately and must never block or fail agent shutdown.
- Markdown output must survive concurrent Pi and Claude Code completions through locking or equivalent atomic writes.
- Markdown writing is independent of SQLite indexing; an indexing failure must not remove a successfully written Markdown summary.
- The public project name and package name are `obsidian-agent-tools`; do not retain old public Claude-specific compatibility aliases in the new project.
- The old GitHub repository is archived only after the new repository is implemented and verified.

---

## File map

Create or modify these files in the implementation checkout before publishing the new repository:

- Modify `package.json`: neutral package metadata, scripts, test dependencies, and executable entries.
- Modify `tsconfig.json`: compile the new source tree and preserve declaration output.
- Modify `.gitignore`: exclude runtime data, test fixtures generated at runtime, and local build artifacts.
- Create `vitest.config.ts`: TypeScript test configuration with no live Ollama/network requirement.
- Create `src/core/config.ts`: one typed configuration reader for vault, data, Ollama, and summary settings.
- Create `src/core/session-format.ts`: normalized session input, model result, transcript limits, prompt rules, and metadata formatting.
- Create `src/core/ollama.ts`: Ollama health/model/pull/chat client.
- Create `src/core/session-writer.ts`: locked append to `_agent_sessions` and date/header/entry rendering.
- Create `src/core/session-pipeline.ts`: validate input, summarize, write Markdown, index, and isolate indexing failures.
- Modify `src/summarizer/index.ts`: make the CLI consume normalized session JSON and call the shared pipeline.
- Remove `src/summarizer/vertex.ts`: remote Vertex summarization is no longer part of the new project.
- Modify `src/summarizer/transcript.ts`: retain Claude JSONL parsing, expose shared truncation, and add Pi-compatible normalization helpers where appropriate.
- Remove `src/summarizer/daily-note.ts` after moving all callers to `src/core/session-writer.ts`; eliminate old `_claude_sessions`/daily-note output paths.
- Modify `src/search/embed.ts`: use the shared Ollama configuration rather than a separate `OLLAMA_URL` implementation.
- Modify `src/db/index.ts`: replace `CLAUDE_OBSIDIAN_DATA_DIR` with neutral data configuration and store runtime metadata if the schema needs it.
- Modify `src/db/migrations/001_initial.sql` only when the existing schema can accept the runtime field without data loss; otherwise create `src/db/migrations/002_add_runtime.sql` and apply it through the existing migration runner. Preserve all existing records.
- Modify `src/tools/*.ts` and `src/cli.ts` only where public names or environment variables are Claude-specific; preserve all current MCP capabilities.
- Create `integrations/claude-code/normalize-session.ts`: Claude hook JSONL-to-normalized-session adapter.
- Create `integrations/claude-code/on-session-end`: Claude Code SessionEnd shell launcher.
- Create `integrations/claude-code/on-post-compact`: compact-event adapter using the shared writer contract.
- Create `integrations/pi/obsidian-agent-tools.ts`: Pi shutdown adapter.
- Create `bin/obsidian-agent-summarize`: stable launcher for the compiled shared summarizer.
- Create `tests/core/*.test.ts`: core unit tests.
- Create `tests/integrations/*.test.ts`: Claude/Pi fixture and adapter tests.
- Create `tests/fixtures/claude-session.jsonl` and `tests/fixtures/pi-session.json`: representative native inputs.
- Modify `README.md`: generalized product description, MCP setup, Claude Code setup, Pi setup, Ollama setup, configuration, verification, and migration notice.
- Create `docs/migration-from-claude-obsidian.md`: explicit old-repository migration guidance without promising compatibility aliases.

---

### Task 1: Establish neutral package identity and test harness

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Produces the `npm test` command and a TypeScript test runner used by every later task.
- Does not change runtime behavior of the MCP server yet.

- [ ] **Step 1: Add the failing smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs TypeScript tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Add the test runner and neutral package metadata**

Update `package.json` with these exact changes:

```json
{
  "name": "obsidian-agent-tools",
  "scripts": {
    "build": "tsc && cp -r src/db/migrations dist/db/",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  }
}
```

Add `vitest` to `devDependencies` using the repository’s package manager, while retaining the existing dependencies and Node engine `>=18`.

- [ ] **Step 3: Configure Vitest and TypeScript test discovery**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});
```

Keep `tsconfig.json`’s production `rootDir` as `src` and exclude `tests` from the production compiler input. Vitest must transpile test files independently.

- [ ] **Step 4: Ignore local runtime state**

Add these patterns to `.gitignore`:

```gitignore
.local/
*.db
*.db-shm
*.db-wal
coverage/
```

- [ ] **Step 5: Run the harness**

Run:

```bash
npm test -- --run
npm run build
```

Expected: the smoke test passes and the existing source still compiles.

---

### Task 2: Centralize configuration and transcript contracts

**Files:**
- Create: `src/core/config.ts`
- Create: `src/core/session-format.ts`
- Modify: `src/summarizer/transcript.ts`
- Create: `tests/core/config.test.ts`
- Create: `tests/core/session-format.test.ts`

**Interfaces:**
- Produces `AgentConfig`, `NormalizedSession`, `SummaryResult`, `loadConfig()`, `formatTranscript()`, `validateNormalizedSession()`, and `renderSessionEntry()` for Tasks 3–7.
- `NormalizedSession` is:

```ts
export interface NormalizedSession {
  runtime: "claude-code" | "pi";
  sessionId: string;
  transcript: string;
  cwd: string;
}
```

- `SummaryResult` is:

```ts
export interface SummaryResult {
  topic: string;
  summary: string;
}
```

- [ ] **Step 1: Write configuration tests**

Test that `loadConfig()` returns these defaults when environment variables are absent:

```ts
expect(config.vaultPath).toBe(join(homedir(), "obsidian-git-sync"));
expect(config.ollamaHost).toBe("http://127.0.0.1:11434");
expect(config.summaryModel).toBe("qwen2.5:7b");
```

Also test overrides for `OBSIDIAN_VAULT`, `OBSIDIAN_DATA_DIR`, `OLLAMA_HOST`, `OBSIDIAN_SUMMARY_MODEL`, and `OBSIDIAN_SUMMARY_MAX_CHARS`.

- [ ] **Step 2: Implement the typed configuration reader**

Create `src/core/config.ts` with this public shape:

```ts
export interface AgentConfig {
  vaultPath: string;
  dataDir: string;
  ollamaHost: string;
  summaryModel: string;
  summaryMaxChars: number;
  summaryMinTurns: number;
  summaryMinChars: number;
}

export function loadConfig(env?: NodeJS.ProcessEnv): AgentConfig;
```

Use `OBSIDIAN_VAULT` with `$HOME/obsidian-git-sync` as the default, `$HOME/.local/share/obsidian-agent-tools` for `dataDir`, `http://127.0.0.1:11434` for `ollamaHost`, `qwen2.5:7b` for `summaryModel`, `50000` for `summaryMaxChars`, `2` for `summaryMinTurns`, and `200` for `summaryMinChars`. Strip a trailing slash from `ollamaHost`.

- [ ] **Step 3: Write session-contract tests**

Cover:

```ts
expect(validateNormalizedSession({
  runtime: "pi",
  sessionId: "s1",
  transcript: "[user]: hi\n\n[assistant]: done",
  cwd: "/tmp/project",
})).toEqual(validInput);
```

Reject empty `sessionId`, empty `transcript`, empty `cwd`, and runtime values other than `pi` or `claude-code`. Test truncation appends exactly `\n\n[...truncated]` after the configured limit. Test rendered entries include runtime, session ID, shortened CWD, and the Pi-style separator.

- [ ] **Step 4: Implement the shared session format**

Create these functions:

```ts
export function validateNormalizedSession(value: unknown): NormalizedSession;
export function formatTranscript(transcript: string, maxChars: number): string | null;
export function shortenCwd(cwd: string, home?: string): string;
export function parseSummaryResponse(text: string): SummaryResult | null;
export function renderSessionEntry(
  date: string,
  session: NormalizedSession,
  result: SummaryResult,
  time: string,
): string;
```

`formatTranscript()` returns `null` for fewer than two labeled turns or fewer than 200 total characters. It truncates at 50,000 characters by default. `parseSummaryResponse()` accepts the preferred `<topic>...</topic>`/`<summary>...</summary>` form and the fallback first-line-topic form, then rejects empty values, topics over 60 characters, and summaries containing Markdown headings or fenced code blocks. `renderSessionEntry()` must produce a plain-prose summary body and metadata in this exact order: Runtime, Session, CWD.

- [ ] **Step 5: Adapt Claude transcript parsing to the shared formatter**

Keep `parseTranscript(path)` for Claude JSONL input, but make `formatTranscript(turns, maxChars)` use the shared limits and exact `[user]:`/`[assistant]:` format. Do not change the existing JSONL rules that skip tool blocks and malformed lines.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- --run tests/core/config.test.ts tests/core/session-format.test.ts
npm run build
```

Expected: all configuration, validation, truncation, parsing, and rendering tests pass.

---

### Task 3: Implement the Ollama summarizer client

**Files:**
- Create: `src/core/ollama.ts`
- Create: `tests/core/ollama.test.ts`

**Interfaces:**
- Consumes `AgentConfig` and `SummaryResult` parsing from Task 2.
- Produces:

```ts
export interface OllamaClient {
  ensureModel(): Promise<void>;
  summarize(transcript: string): Promise<SummaryResult | null>;
}

export function createOllamaClient(config: AgentConfig): OllamaClient;
```

- [ ] **Step 1: Write fake-server tests**

Use a local fake HTTP server and mock `child_process.execFile` to test:

1. `GET /api/tags` reports the configured model and no pull occurs.
2. Missing model invokes `ollama pull qwen2.5:7b` exactly once.
3. `/api/chat` receives the configured model, `stream: false`, and a prompt containing the transcript.
4. A valid tagged response returns `{ topic, summary }`.
5. HTTP failure and invalid response return `null` or throw the documented error without contacting any remote URL.
6. Abort after 30 seconds produces a logged failure.

- [ ] **Step 2: Implement model availability and pull**

Implement `createOllamaClient(config)` using native `fetch` for `GET ${ollamaHost}/api/tags`. If the configured model is absent, invoke:

```ts
execFile("ollama", ["pull", config.summaryModel], { timeout: 10 * 60 * 1000 })
```

Do not shell-interpolate model names or URLs. If the health check or pull fails, throw an error containing the configured host and model.

- [ ] **Step 3: Implement the shared prompt and chat request**

Send `POST ${ollamaHost}/api/chat` with:

```json
{
  "model": "qwen2.5:7b",
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "...shared prompt..."
    }
  ]
}
```

The prompt must require a topic under 60 characters and a 3–6 sentence plain-prose handoff covering accomplishments, decisions, current status, and next steps only when supported by the transcript. Parse the response through `parseSummaryResponse()` from Task 2.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run tests/core/ollama.test.ts
npm run build
```

Expected: fake Ollama tests pass and no live Ollama process or network service is required.

---

### Task 4: Add safe shared Markdown persistence

**Files:**
- Create: `src/core/session-writer.ts`
- Create: `tests/core/session-writer.test.ts`
- Remove or stop using: `src/summarizer/daily-note.ts`

**Interfaces:**
- Consumes `NormalizedSession`, `SummaryResult`, and `AgentConfig`.
- Produces:

```ts
export interface SessionWriter {
  append(session: NormalizedSession, result: SummaryResult, now?: Date): Promise<string>;
}

export function createSessionWriter(config: AgentConfig): SessionWriter;
```

- [ ] **Step 1: Write writer tests against a temporary vault**

Test that the first append creates:

```text
<temp-vault>/4_Archive/_agent_sessions/YYYY-MM-DD.md
```

with header `# Agent Sessions — YYYY-MM-DD`, and that the second append adds `\n\n---\n\n` before the next entry. Assert the exact Runtime/Session/CWD metadata and that `~` replaces the home directory.

Test two concurrent `append()` calls result in both complete entries being present and neither file write loses the other entry.

- [ ] **Step 2: Implement the dated path and renderer**

Create the directory with `mkdir(..., { recursive: true })`. Derive the date and time from the supplied `Date`, not from multiple independent `new Date()` calls. Call `renderSessionEntry()` from Task 2 and prepend the header only for a new file.

- [ ] **Step 3: Implement lock acquisition and release**

Use a lock file beside the dated Markdown file, created with exclusive mode. Retry with a bounded delay for up to 10 seconds. Remove the lock in a `finally` block. On timeout, throw an error and leave the existing Markdown file untouched.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run tests/core/session-writer.test.ts
```

Expected: creation, append ordering, CWD rendering, and concurrent-write tests pass.

---

### Task 5: Build the shared session pipeline and neutralize indexing configuration

**Files:**
- Create: `src/core/session-pipeline.ts`
- Modify: `src/db/index.ts`
- Modify: `src/search/embed.ts`
- Modify: `src/db/migrations/001_initial.sql` only if a runtime column is added
- Create: `tests/core/session-pipeline.test.ts`
- Create: `tests/db/config.test.ts`

**Interfaces:**
- Consumes `OllamaClient`, `SessionWriter`, `AgentConfig`, and existing `indexSummary()`/`embed()`.
- Produces:

```ts
export interface SessionPipeline {
  process(input: unknown): Promise<{ path: string } | null>;
}

export function createSessionPipeline(
  config: AgentConfig,
  dependencies?: {
    ollama?: OllamaClient;
    writer?: SessionWriter;
    embed?: typeof embed;
    index?: typeof indexSummary;
  },
): SessionPipeline;
```

- [ ] **Step 1: Write pipeline tests with injected fakes**

Cover these cases:

```ts
const result = await pipeline.process(validInput);
expect(result?.path).toContain("_agent_sessions");
expect(fakeWriter.calls).toHaveLength(1);
expect(fakeIndex.calls).toHaveLength(1);
```

Also test malformed input, short transcript, Ollama failure, writer failure, embedding failure, and index failure. For index failure, assert that the writer result remains successful and the error is logged.

- [ ] **Step 2: Implement pipeline orchestration**

Implement this order:

1. `validateNormalizedSession(input)`.
2. `formatTranscript(input.transcript, config.summaryMaxChars)` and skip on `null`.
3. `ollama.ensureModel()`.
4. `ollama.summarize(formattedTranscript)` and skip on `null`.
5. `writer.append(input, result)`.
6. Generate an embedding using the topic and summary, treating `null` as best effort.
7. Call `indexSummary()` with one UUID, session ID, date, CWD, topic, summary, and embedding.
8. Catch/log indexing errors without changing the returned Markdown path.

- [ ] **Step 3: Neutralize the database data directory**

Change `src/db/index.ts` to consume `loadConfig().dataDir` or an injected path. The default must be `$HOME/.local/share/obsidian-agent-tools`, and database initialization must continue to run migrations and WAL mode.

If runtime metadata is needed for search results, add a migration that adds `runtime TEXT NOT NULL DEFAULT 'unknown'`, update `indexSummary()` and search result types, and preserve all existing rows. Do not rewrite or delete the existing database.

- [ ] **Step 4: Unify embedding configuration**

Change `src/search/embed.ts` to use the same `OLLAMA_HOST` value as the summarizer. Preserve the existing `nomic-embed-text` model and best-effort null return, but remove the separate `OLLAMA_URL` configuration path.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
npm test -- --run tests/core/session-pipeline.test.ts tests/db/config.test.ts
npm run build
npm test -- --run
```

Expected: pipeline isolation, neutral data paths, and the complete test suite pass.

---

### Task 6: Convert the summarizer CLI to the shared contract

**Files:**
- Modify: `src/summarizer/index.ts`
- Modify: `src/summarizer/transcript.ts`
- Remove: `src/summarizer/vertex.ts`
- Create: `tests/summarizer/index.test.ts`
- Modify: `bin/on-session-end` or replace it with `integrations/claude-code/on-session-end`
- Create: `bin/obsidian-agent-summarize`

**Interfaces:**
- The compiled CLI accepts one temporary JSON file containing `NormalizedSession`.
- The CLI calls `createSessionPipeline(config).process(input)` and exits with status 0 for handled skips and status 1 only for malformed invocation or uncaught fatal errors.
- Claude’s adapter continues to use `parseTranscript()` before creating `NormalizedSession`.

- [ ] **Step 1: Write CLI tests**

Mock the pipeline and filesystem to verify:

1. Missing argument logs `error: no temp file argument provided` and exits nonzero.
2. Invalid JSON logs a parse error and exits nonzero.
3. Valid normalized input reaches the pipeline unchanged.
4. A short/handled session exits successfully without a Markdown file.

- [ ] **Step 2: Implement the neutral CLI**

Replace the current Vertex-specific imports and orchestration in `src/summarizer/index.ts` with:

```ts
const input = JSON.parse(readFileSync(tempFile, "utf-8"));
const pipeline = createSessionPipeline(loadConfig());
await pipeline.process(input);
```

Retain timestamped logging, but write logs under `$HOME/.local/share/obsidian-agent-tools/summarize.log`.

- [ ] **Step 3: Add the stable launcher**

Create `bin/obsidian-agent-summarize`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
exec node "${OBSIDIAN_AGENT_SUMMARIZER:-$PROJECT_DIR/dist/summarizer/index.js}" "$@"
```

Make it executable. It must resolve the local compiled CLI by default and permit an explicit executable override.

- [ ] **Step 4: Remove Vertex code and old output path**

Delete `src/summarizer/vertex.ts`. Ensure no source file imports it and no source file writes `_claude_sessions`, `_pi_sessions`, `## Claude Summaries`, or a Claude-specific daily-note summary format.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- --run tests/summarizer/index.test.ts
npm run build
rg -n "vertex|_claude_sessions|_pi_sessions|CLAUDE_OBSIDIAN" src bin
```

Expected: tests pass, build succeeds, and the search reports no production references to the removed summarizer/path configuration.

---

### Task 7: Implement the Claude Code lifecycle adapter

**Files:**
- Create: `integrations/claude-code/on-session-end`
- Create: `integrations/claude-code/on-post-compact`
- Create: `tests/integrations/claude-code.test.ts`
- Remove or stop installing: `bin/on-stop`
- Remove or replace: `bin/on-session-end`

**Interfaces:**
- `on-session-end` reads Claude hook JSON from stdin and invokes `bin/obsidian-agent-summarize` with a temporary normalized JSON file.
- The hook payload fields are `session_id`, `transcript_path`, and `cwd`.
- The adapter never calls Ollama or writes Markdown directly.

- [ ] **Step 1: Add fixture coverage**

Create `tests/fixtures/claude-session.jsonl` with at least one user message, one assistant text message, one tool result, and one malformed line. Test that only user/assistant text reaches the normalized transcript and that tool blocks are omitted.

- [ ] **Step 2: Implement SessionEnd hook**

Write a Bash hook that:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${OBSIDIAN_DATA_DIR:-${HOME}/.local/share/obsidian-agent-tools}"
TMPFILE="$(mktemp /tmp/obsidian-agent-tools.XXXXXX)"
trap 'rm -f "$TMPFILE"' EXIT

cat > "$TMPFILE"
mkdir -p "$DATA_DIR"
nohup "$PROJECT_DIR/bin/obsidian-agent-summarize" "$TMPFILE" \
  >> "$DATA_DIR/summarize.log" 2>&1 &
```

The hook must first convert the native Claude payload into the normalized JSON contract, including `runtime: "claude-code"`, before launching the background process. Use a small Node helper in `integrations/claude-code/normalize-session.ts` if shell JSONL parsing would be brittle; do not depend on `jq` for transcript parsing.

- [ ] **Step 3: Implement PostCompact with the shared writer contract**

Read `summary`, `session_id`, and `cwd` from the PostCompact JSON, create a normalized compact-event payload, and invoke a shared writer command that emits the same Runtime/Session/CWD metadata. Do not append directly to `_daily_notes`.

- [ ] **Step 4: Add adapter tests**

Use temporary stdin files and a fake summarizer executable to assert the hook exits within one second, creates the normalized payload, passes the correct runtime/session/cwd, and does not write to `_daily_notes`.

- [ ] **Step 5: Verify shell syntax and permissions**

Run:

```bash
chmod +x integrations/claude-code/on-session-end integrations/claude-code/on-post-compact
bash -n integrations/claude-code/on-session-end integrations/claude-code/on-post-compact
npm test -- --run tests/integrations/claude-code.test.ts
```

Expected: shell syntax passes and adapter fixture tests pass.

---

### Task 8: Implement the Pi extension adapter

**Files:**
- Create: `integrations/pi/obsidian-agent-tools.ts`
- Create: `integrations/pi/session-normalize.ts`
- Create: `tests/fixtures/pi-session.json`
- Create: `tests/integrations/pi.test.ts`
- Remove or stop using: `$HOME/.pi/agent/extensions/obsidian-summarize/summarizer.mjs` in the installation instructions

**Interfaces:**
- `buildPiTranscript(entries: unknown[]): string | null` returns the same `[user]`/`[assistant]` transcript format and applies the shared minimum/truncation rules.
- The default export is `function obsidianAgentTools(pi: ExtensionAPI): void`.
- The extension writes a normalized temporary JSON object with `runtime: "pi"`, `sessionId`, `transcript`, and `cwd`, then spawns `bin/obsidian-agent-summarize` detached with inherited environment.

- [ ] **Step 1: Add Pi fixture tests**

The fixture must include user and assistant text, non-text content blocks, a reload/switch shutdown reason, and a quit shutdown reason. Assert that non-text blocks are omitted and non-quit reasons do not invoke the summarizer.

- [ ] **Step 2: Implement Pi normalization**

Move the current Pi branch extraction rules into `integrations/pi/session-normalize.ts`. Accept string or text-block content, keep only `user` and `assistant` messages, reject fewer than two turns or fewer than 200 characters, format turns exactly as the Claude adapter does, and cap the transcript at 50,000 characters with `[...truncated]`.

- [ ] **Step 3: Implement the detached extension**

Use `pi.on("session_shutdown", async (event, ctx) => { ... })`. Return unless `event.reason === "quit"`, obtain the branch from `ctx.sessionManager.getBranch()`, normalize it, write a unique temp JSON file, and spawn the configured executable from `OBSIDIAN_AGENT_SUMMARIZER` or the repository-installed launcher with `detached: true`, `stdio: "ignore"`, and `env: { ...process.env }`. Call `unref()` and catch all adapter errors.

- [ ] **Step 4: Add extension tests**

Mock `spawn`, `writeFileSync`, and the Pi API. Assert the exact normalized payload, detached process options, `unref()` call, and best-effort behavior on exceptions.

- [ ] **Step 5: Run Pi tests and compile**

Run:

```bash
npm test -- --run tests/integrations/pi.test.ts
npm run build
```

Expected: fixture and lifecycle tests pass and the extension compiles against the installed Pi type definitions.

---

### Task 9: Generalize MCP configuration and preserve all notebook tools

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Modify: `src/tools/aliases.ts`
- Modify: `src/tools/graph.ts`
- Modify: `src/tools/manage.ts`
- Modify: `src/tools/properties.ts`
- Modify: `src/tools/property-write.ts`
- Modify: `src/tools/read.ts`
- Modify: `src/tools/search.ts`
- Modify: `src/tools/search-sessions.ts`
- Modify: `src/tools/session.ts`
- Modify: `src/tools/tags.ts`
- Modify: `src/tools/task-update.ts`
- Modify: `src/tools/tasks.ts`
- Modify: `src/tools/vault.ts`
- Modify: `src/tools/write.ts`
- Create: `tests/mcp/config.test.ts`

**Interfaces:**
- Preserve every existing MCP tool name and action unless it contains a public Claude-specific product name.
- `OBSIDIAN_VAULT` is the only documented vault variable in the new package.
- Session tools read `_agent_sessions` through the existing vault-relative mechanisms where applicable and continue to provide context/morning/search behavior.

- [ ] **Step 1: Inventory and test current tool registration**

Add a registration test that imports the server setup and asserts all current tools are present: vault, read, write, manage, search, graph, tags, aliases, properties, property write, tasks, task update, session, and search sessions.

- [ ] **Step 2: Generalize CLI configuration**

Change `src/cli.ts` to use `OBSIDIAN_VAULT` and the neutral config module. Keep `OBSIDIAN_CLI_PATH` for the Obsidian binary path because it describes the external CLI rather than a harness identity.

- [ ] **Step 3: Remove Claude-specific descriptions and defaults**

Update tool descriptions, session-file defaults, log paths, and comments that call the server Claude-only. Keep behavior and tool schemas intact. Do not reintroduce the removed project-index behavior unless it is required by an existing tool contract.

- [ ] **Step 4: Run registration and build checks**

Run:

```bash
npm test -- --run tests/mcp/config.test.ts
npm run build
```

Expected: all tools remain registered and the neutral package compiles.

---

### Task 10: Update documentation and local verification tooling

**Files:**
- Modify: `README.md`
- Create: `docs/migration-from-claude-obsidian.md`
- Create: `scripts/smoke-test-local.sh`
- Modify: `.gitignore`

**Interfaces:**
- Documentation must allow a developer with a clean machine to configure MCP, Claude Code, Pi, and Ollama without reading source code.
- The smoke test must not require a live model for its fake-server path.

- [ ] **Step 1: Rewrite the README identity and prerequisites**

Describe `obsidian-agent-tools` as an Obsidian integration for agent harnesses. List Node.js >=18, Obsidian CLI support, Ollama, Claude Code and/or Pi as optional harnesses, and the local model `qwen2.5:7b`.

- [ ] **Step 2: Document configuration exactly**

Add a table with:

```text
OBSIDIAN_VAULT
OBSIDIAN_DATA_DIR
OBSIDIAN_CLI_PATH
OLLAMA_HOST
OBSIDIAN_SUMMARY_MODEL
OBSIDIAN_AGENT_SUMMARIZER
```

Document defaults and explain that transcripts are not sent to a remote provider.

- [ ] **Step 3: Document installation for each surface**

Include separate commands for:

1. Building and registering the MCP server.
2. Registering Claude Code SessionEnd/PostCompact hooks.
3. Loading the Pi extension.
4. Installing or pulling the Ollama model.
5. Running the shared summarizer manually with a normalized JSON fixture.

- [ ] **Step 4: Add migration documentation**

Explain that the old GitHub repository is archived, the new package is `obsidian-agent-tools`, old `_claude_sessions` and `_pi_sessions` files are intentionally left in place, and no old public aliases are supported.

- [ ] **Step 5: Add a smoke-test script**

Create `scripts/smoke-test-local.sh` that builds the project, starts a fake Ollama server or runs the existing fake-server test command, invokes the shared summarizer with a temporary normalized session, and asserts that exactly one dated file under `_agent_sessions` contains the topic, summary, runtime, session ID, and CWD.

- [ ] **Step 6: Run documentation and verification checks**

Run:

```bash
bash -n scripts/smoke-test-local.sh
npm run build
npm test -- --run
```

Expected: shell syntax, build, and all automated tests pass.

---

### Task 11: Verify the new repository and archive transition

**Files:**
- Create or modify: new GitHub repository metadata for `obsidian-agent-tools`
- Modify: archived old repository README with migration notice
- Verify: `package.json`, `README.md`, `docs/migration-from-claude-obsidian.md`

**Interfaces:**
- Produces a clean public repository named `obsidian-agent-tools`.
- Does not move or copy historical `_claude_sessions` or `_pi_sessions` files.

- [ ] **Step 1: Confirm no old public identity remains**

Run:

```bash
rg -n "claude-obsidian|CLAUDE_OBSIDIAN|Claude Code full access|_claude_sessions|_pi_sessions" \
  package.json README.md docs src integrations bin
```

Expected: no old package identity, old data variable, or old session directory appears in new public code or documentation. Historical migration documentation may mention old names only when explaining the migration.

- [ ] **Step 2: Create the new repository from the verified implementation**

Create the `obsidian-agent-tools` GitHub repository, set its package/repository metadata, push the verified branch, and confirm the published README points to the new name.

- [ ] **Step 3: Install from the new repository in a clean shell**

Run the documented MCP registration and Pi/Claude adapter setup from a shell that does not depend on the original workspace path. Confirm that `OBSIDIAN_AGENT_SUMMARIZER` or the installed launcher resolves correctly.

- [ ] **Step 4: Archive the old repository**

After the clean install and smoke test pass, add a migration link to the old README and archive the old GitHub repository. Do not delete it and do not alter existing historical session files.

- [ ] **Step 5: Record final verification**

Run:

```bash
npm run build
npm test -- --run
npm pack --dry-run
```

Expected: build and all tests pass, and the package contents include the MCP build, shared summarizer launcher, and integration files required by the installation documentation.
