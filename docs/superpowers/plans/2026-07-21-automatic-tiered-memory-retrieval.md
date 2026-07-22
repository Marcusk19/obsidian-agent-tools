# Automatic Tiered Memory Retrieval Implementation Plan

> **Status:** Implemented with a refined low-context hot path. The current behavior and defaults are documented in `README.md`; examples below preserve the original planning record and may contain superseded budgets or escalation rules.
>
> **For agentic workers:** This plan is documentation only. Do not automatically invoke implementation subskills. If the user explicitly requests execution, ask them to choose an execution skill first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically retrieve a small, relevant set of Obsidian memories before each agent turn, expanding from durable memory to scoped project notes and broader vault context without overflowing the model context window.

**Architecture:** Add a shared, runtime-neutral retrieval layer that classifies each prompt into bounded retrieval tiers, filters indexed notes by path and metadata, reads only selected source notes, and renders a compact Markdown context block. Expose that layer through a CLI command so Pi and Claude Code adapters use identical behavior. Pi injects the block through `before_agent_start`; Claude Code injects it through its user-prompt lifecycle hook. Deeper retrieval remains available through the existing search tools rather than being injected automatically.

**Tech Stack:** TypeScript, Node.js >=18, Vitest, SQLite FTS5/sqlite-vec vault index, Pi ExtensionAPI, Claude Code hook JSON, Obsidian Markdown frontmatter.

## Global Constraints

- Keep Markdown notes as the canonical source of truth; `vault-index.db` remains disposable derived state.
- Preserve the three retrieval tiers: `3_Resource/agent memory/`, scoped notes under `1_Projects/`, then broader vault context.
- Search project knowledge in `1_Projects/`; do not recreate `3_Resource/agent memory/projects/`.
- Apply a hard injected-context budget of 4,000 tokens, approximated by 16,000 UTF-8 characters when an exact tokenizer is unavailable.
- Never inject complete source notes by default; inject compact excerpts with source paths and headings.
- Prefer `confidence: confirmed`, active notes, matching repository/project scope, and recent notes; do not silently resolve contradictory sources.
- Preserve explicit vault configuration through `OBSIDIAN_VAULT`, `OBSIDIAN_DATA_DIR`, and `OBSIDIAN_VAULT_NAME` where the Obsidian CLI is used.
- Retrieval failures must not block the user prompt or prevent the agent from running.
- Do not store prompts, retrieved context, or secrets in durable memory as part of this feature.

---

## File Structure

- Create `src/memory/types.ts` for retrieval request, tier, candidate, and rendered-context types.
- Create `src/memory/retrieve.ts` for tier selection, bounded retrieval, scope filtering, ranking, and source-note expansion.
- Create `src/memory/render.ts` for deterministic Markdown rendering and the character/token budget.
- Modify `src/search/vault-search.ts` to support optional path-prefix and metadata filtering without changing existing callers.
- Create `src/commands/memory-context.ts` for the shared command implementation.
- Create `bin/obsidian-agent-context` as the executable wrapper for the new command.
- Modify `src/core/config.ts` to expose retrieval limits and the context budget through environment variables.
- Create `tests/memory/retrieve.test.ts` for tier routing and bounded selection.
- Create `tests/memory/render.test.ts` for deterministic output, deduplication, and budget enforcement.
- Modify `tests/search/vault-search.test.ts` for scoped path filtering.
- Create `tests/commands/memory-context.test.ts` for CLI argument parsing and failure-safe output.
- Modify `integrations/pi/obsidian-agent-tools.ts` to inject context in `before_agent_start` while retaining the existing shutdown summarizer.
- Create `tests/integrations/pi/obsidian-agent-tools.test.ts` for prompt-to-context injection behavior.
- Create `integrations/claude-code/on-user-prompt-submit` for Claude Code prompt-hook adaptation.
- Create `tests/integrations/claude-code/on-user-prompt-submit.test.ts` for hook JSON and output behavior.
- Modify `README.md` to document installation, lifecycle behavior, budgets, and opt-out configuration.

---

### Task 1: Define the shared retrieval contracts and configuration

**Files:**
- Create: `src/memory/types.ts`
- Modify: `src/core/config.ts:4-33`
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces `MemoryTier = "durable" | "project" | "broad"`.
- Produces `MemoryRetrievalRequest` with `{ prompt: string; cwd?: string; repository?: string; project?: string; maxChars: number }`.
- Produces `MemoryCandidate` with `{ path: string; title: string; tier: MemoryTier; confidence: "confirmed" | "semantic"; excerpt: string; sourceHeading?: string; score: number }`.
- Produces config fields `memoryMaxChars`, `memoryMaxResults`, `memoryProjectResults`, and `memoryBroadResults`.

- [ ] **Step 1: Write the failing type/config test**

Add this case to `tests/core/config.test.ts`:

```ts
it("loads bounded automatic memory retrieval settings", () => {
  const config = loadConfig({
    HOME: "/home/test",
    OBSIDIAN_MEMORY_MAX_CHARS: "12000",
    OBSIDIAN_MEMORY_MAX_RESULTS: "4",
    OBSIDIAN_MEMORY_PROJECT_RESULTS: "2",
    OBSIDIAN_MEMORY_BROAD_RESULTS: "1",
  });

  expect(config.memoryMaxChars).toBe(12000);
  expect(config.memoryMaxResults).toBe(4);
  expect(config.memoryProjectResults).toBe(2);
  expect(config.memoryBroadResults).toBe(1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test -- tests/core/config.test.ts
```

Expected: FAIL because the new config properties do not exist.

- [ ] **Step 3: Add the retrieval contracts and config fields**

Create `src/memory/types.ts`:

```ts
export type MemoryTier = "durable" | "project" | "broad";
export type MemoryConfidence = "confirmed" | "semantic";

export interface MemoryRetrievalRequest {
  prompt: string;
  cwd?: string;
  repository?: string;
  project?: string;
  maxChars: number;
}

export interface MemoryCandidate {
  path: string;
  title: string;
  tier: MemoryTier;
  confidence: MemoryConfidence;
  excerpt: string;
  sourceHeading?: string;
  score: number;
}

export interface MemoryContext {
  candidates: MemoryCandidate[];
  rendered: string;
  truncated: boolean;
}
```

Extend `AgentConfig` and `loadConfig` in `src/core/config.ts` with:

```ts
memoryMaxChars: number;
memoryMaxResults: number;
memoryProjectResults: number;
memoryBroadResults: number;
```

Use these defaults:

```ts
memoryMaxChars: number("OBSIDIAN_MEMORY_MAX_CHARS", 16_000),
memoryMaxResults: number("OBSIDIAN_MEMORY_MAX_RESULTS", 3),
memoryProjectResults: number("OBSIDIAN_MEMORY_PROJECT_RESULTS", 2),
memoryBroadResults: number("OBSIDIAN_MEMORY_BROAD_RESULTS", 1),
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm test -- tests/core/config.test.ts
```

Expected: PASS.

---

### Task 2: Add path-scoped vault search

**Files:**
- Modify: `src/search/vault-search.ts:8-25, 44-78`
- Test: `tests/search/vault-search.test.ts`

**Interfaces:**
- Consumes the existing `searchVault(options)` API.
- Produces optional `pathPrefixes?: string[]` and `statuses?: string[]` filters in `VaultSearchOptions`.
- Existing callers that omit filters retain current whole-vault behavior.

- [ ] **Step 1: Write the failing scoped-search test**

Add this test:

```ts
it("restricts confirmed results to requested path prefixes", async () => {
  root = mkdtempSync(join(tmpdir(), "vault-search-test-"));
  const vaultPath = join(root, "vault");
  const dataDir = join(root, "data");
  mkdirSync(join(vaultPath, "3_Resource", "agent memory"), { recursive: true });
  mkdirSync(join(vaultPath, "1_Projects"), { recursive: true });
  writeFileSync(join(vaultPath, "3_Resource", "agent memory", "rule.md"), "explicit selector rule");
  writeFileSync(join(vaultPath, "1_Projects", "project.md"), "explicit selector project");
  db = openVaultIndex(dataDir);

  const results = await searchVault({
    query: "explicit selector",
    vaultPath,
    dataDir,
    db,
    embed: vi.fn().mockResolvedValue(null),
    pathPrefixes: ["3_Resource/agent memory/"],
  });

  expect(results).toHaveLength(1);
  expect(results[0].path).toBe("3_Resource/agent memory/rule.md");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test -- tests/search/vault-search.test.ts
```

Expected: FAIL because `pathPrefixes` is not accepted and the search is unscoped.

- [ ] **Step 3: Add path-prefix filtering to FTS and semantic candidates**

Extend `VaultSearchOptions`:

```ts
pathPrefixes?: string[];
```

Add a helper that produces a SQL clause using `path LIKE ?` parameters:

```ts
function pathFilter(pathPrefixes?: string[]): { clause: string; params: string[] } {
  if (!pathPrefixes?.length) return { clause: "", params: [] };
  return {
    clause: ` AND (${pathPrefixes.map(() => "path LIKE ?").join(" OR ")})`,
    params: pathPrefixes.map((prefix) => `${prefix}%`),
  };
}
```

Apply the returned clause and parameters to both semantic candidate selection and confirmed/broad keyword selection. Keep SQL values parameterized; do not interpolate user prompt text or path content directly.

- [ ] **Step 4: Run all search tests**

Run:

```bash
pnpm test -- tests/search/vault-search.test.ts
```

Expected: PASS, including the existing semantic-first and fallback tests.

---

### Task 3: Implement bounded tiered retrieval and rendering

**Files:**
- Create: `src/memory/retrieve.ts`
- Create: `src/memory/render.ts`
- Create: `tests/memory/retrieve.test.ts`
- Create: `tests/memory/render.test.ts`

**Interfaces:**
- Consumes `searchVault`, `MemoryRetrievalRequest`, and `AgentConfig`.
- Produces `retrieveMemoryContext(request, config): Promise<MemoryContext>`.
- Produces `renderMemoryContext(candidates, maxChars): { rendered: string; truncated: boolean }`.

- [ ] **Step 1: Write tests for tier ordering and bounded expansion**

Create `tests/memory/retrieve.test.ts` with injected search/read seams rather than real Obsidian access:

```ts
import { describe, expect, it, vi } from "vitest";
import { retrieveMemoryContext } from "../../src/memory/retrieve.js";

it("searches durable memory first and does not broaden when enough confirmed results exist", async () => {
  const search = vi.fn()
    .mockResolvedValueOnce([{ path: "3_Resource/agent memory/rule.md", title: "Rule", confidence: "confirmed", excerpt: "Use pnpm.", semanticScore: 0.1, keywordConfirmed: true }]);

  const result = await retrieveMemoryContext({ prompt: "How should I install dependencies?", maxChars: 16000 }, {
    vaultPath: "/vault",
    dataDir: "/data",
    memoryMaxChars: 16000,
    memoryMaxResults: 3,
    memoryProjectResults: 2,
    memoryBroadResults: 1,
  }, { search });

  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ pathPrefixes: ["3_Resource/agent memory/"] }));
  expect(result.candidates[0].tier).toBe("durable");
});

it("expands to project and broad tiers when durable results are insufficient", async () => {
  const search = vi.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ path: "1_Projects/quay-operator.md", title: "Quay Operator", confidence: "confirmed", excerpt: "Project context.", semanticScore: 0.2, keywordConfirmed: true }])
    .mockResolvedValueOnce([{ path: "4_Archive/_daily_notes/2026-07-21.md", title: "Daily", confidence: "confirmed", excerpt: "Recent context.", semanticScore: 0.3, keywordConfirmed: true }]);

  const result = await retrieveMemoryContext({ prompt: "What did I decide about Quay?", project: "quay-operator", maxChars: 16000 }, {
    vaultPath: "/vault",
    dataDir: "/data",
    memoryMaxChars: 16000,
    memoryMaxResults: 3,
    memoryProjectResults: 2,
    memoryBroadResults: 1,
  }, { search });

  expect(search).toHaveBeenCalledTimes(3);
  expect(result.candidates.map((candidate) => candidate.tier)).toEqual(["project", "broad"]);
});
```

- [ ] **Step 2: Run the memory tests and verify they fail**

Run:

```bash
pnpm test -- tests/memory/retrieve.test.ts
```

Expected: FAIL because the retrieval module does not exist.

- [ ] **Step 3: Implement tier selection and ranking**

Implement `retrieveMemoryContext` with these exact rules:

```ts
export interface RetrievalDependencies {
  search: typeof searchVault;
}

export async function retrieveMemoryContext(
  request: MemoryRetrievalRequest,
  config: AgentConfig,
  dependencies: RetrievalDependencies = { search: searchVault },
): Promise<MemoryContext>;
```

Use these path scopes:

```ts
const durablePrefixes = ["3_Resource/agent memory/"];
const projectPrefixes = ["1_Projects/"];
const broadPrefixes = ["1_Projects/", "2_Areas/", "3_Resource/", "4_Archive/"];
```

Search durable memory first. Search project notes when the durable result count is below `memoryMaxResults`, the prompt contains project/repository terms, or the request explicitly supplies `project`/`repository`. Search broad context only when the accumulated result count is still below the configured total, the prompt asks about history/current plans/notes, or the narrower tiers return no confirmed result. Pass the specific path-prefix list to `searchVault`; never issue an unbounded broad search for an ordinary coding prompt.

Map `VaultSearchResult` to `MemoryCandidate`, assign the tier, discard duplicate paths, sort confirmed before semantic results, and cap each tier using the configured limits. If a search throws, catch the error and continue with the next tier, returning an empty context rather than failing the agent turn.

- [ ] **Step 4: Write renderer tests for provenance and hard limits**

Create `tests/memory/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMemoryContext } from "../../src/memory/render.js";

it("renders source paths and never exceeds the configured character budget", () => {
  const result = renderMemoryContext([
    {
      path: "3_Resource/agent memory/rule.md",
      title: "Rule",
      tier: "durable",
      confidence: "confirmed",
      excerpt: "x".repeat(500),
      score: 0.1,
    },
  ], 180);

  expect(result.rendered).toContain("3_Resource/agent memory/rule.md");
  expect(result.rendered.length).toBeLessThanOrEqual(180);
  expect(result.truncated).toBe(true);
});
```

- [ ] **Step 5: Implement deterministic rendering**

Implement `renderMemoryContext` so it emits:

```md
## Relevant memory context

- **Rule** (`confirmed`, durable)
  Source: `3_Resource/agent memory/rule.md`
  xxxxxxxxx...

Use this context as guidance. Read the source note when exact details matter.
```

Render candidates in tier order (`durable`, `project`, `broad`) and confidence order (`confirmed`, `semantic`). Add each complete candidate only if it fits the remaining budget; otherwise truncate the final excerpt and set `truncated: true`. Return `""` for an empty candidate list. Do not include raw frontmatter or full note contents.

- [ ] **Step 6: Run all memory tests**

Run:

```bash
pnpm test -- tests/memory
```

Expected: PASS.

---

### Task 4: Expose retrieval through a shared CLI command

**Files:**
- Create: `src/commands/memory-context.ts`
- Create: `bin/obsidian-agent-context`
- Create: `tests/commands/memory-context.test.ts`
- Modify: `package.json:8-15`

**Interfaces:**
- Consumes `obsidian-agent-context [--cwd PATH] [--repository NAME] [--project NAME] <prompt>`.
- Produces rendered Markdown on stdout and no output on an empty/failing lookup.
- Exit status is zero for retrieval misses and nonzero only for malformed command-line arguments.

- [ ] **Step 1: Write parser and failure-safe command tests**

Test these cases:

```ts
expect(parseArgs(["--project", "quay-operator", "What", "did", "we", "decide?"])).toEqual({
  prompt: "What did we decide?",
  project: "quay-operator",
});
expect(() => parseArgs([])).toThrow("Usage: obsidian-agent-context");
```

Also inject a retriever that rejects and assert `run()` writes an empty string and resolves without throwing.

- [ ] **Step 2: Run the focused command tests and verify they fail**

Run:

```bash
pnpm test -- tests/commands/memory-context.test.ts
```

Expected: FAIL because the command module does not exist.

- [ ] **Step 3: Implement the command and executable**

`src/commands/memory-context.ts` must parse the prompt and optional scope flags, load `loadConfig()`, call `retrieveMemoryContext()`, and write only `context.rendered` to stdout. Use `process.env.OBSIDIAN_MEMORY_ENABLED === "0"` as an immediate no-output opt-out.

Create `bin/obsidian-agent-context`:

```sh
#!/bin/sh
exec node "$(dirname "$0")/../dist/cli.js" memory-context "$@"
```

Register the command in `src/cli.ts` and add the package bin entry:

```json
"obsidian-agent-context": "bin/obsidian-agent-context"
```

- [ ] **Step 4: Run command and build tests**

Run:

```bash
pnpm test -- tests/commands/memory-context.test.ts
pnpm build
```

Expected: tests pass and TypeScript compilation succeeds.

---

### Task 5: Inject bounded context into Pi before each agent turn

**Files:**
- Modify: `integrations/pi/obsidian-agent-tools.ts:34-65`
- Create: `tests/integrations/pi/obsidian-agent-tools.test.ts`

**Interfaces:**
- Consumes Pi's `before_agent_start` event with `event.prompt` and `ctx.cwd`.
- Produces a returned `{ message: { customType: "obsidian-memory", content, display: false } }` when context is available.
- Preserves the existing `session_shutdown` behavior unchanged.

- [ ] **Step 1: Write the failing Pi event test**

Mock `child_process.spawn` and register the extension against a fake `pi.on`. Invoke the captured `before_agent_start` handler with:

```ts
{ prompt: "How should this repository run tests?" }
```

Mock the context command to return `## Relevant memory context\n...` and assert the handler returns a hidden custom message containing that text. Add a second test where the command fails and assert the handler returns `undefined` without throwing.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test -- tests/integrations/pi/obsidian-agent-tools.test.ts
```

Expected: FAIL because no `before_agent_start` handler is registered.

- [ ] **Step 3: Add the non-blocking pre-turn handler**

Register:

```ts
pi.on("before_agent_start", async (event, ctx) => {
  if (process.env.OBSIDIAN_MEMORY_ENABLED === "0") return;
  const prompt = (event as { prompt?: string }).prompt?.trim();
  if (!prompt) return;

  try {
    const executable = process.env.OBSIDIAN_AGENT_CONTEXT || join(process.env.HOME || "/tmp", ".local", "bin", "obsidian-agent-context");
    const output = await execFile(executable, ["--cwd", ctx.cwd, prompt], { timeout: 1500, maxBuffer: 20_000 });
    if (!output.stdout.trim()) return;
    return {
      message: {
        customType: "obsidian-memory",
        content: output.stdout.trim(),
        display: false,
      },
    };
  } catch (error) {
    log(`memory retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
});
```

Use `execFile` with a timeout rather than a shell command so prompts cannot be interpreted as shell syntax. Import it from `node:child_process` alongside the existing detached `spawn` import.

- [ ] **Step 4: Run Pi tests and the full suite**

Run:

```bash
pnpm test -- tests/integrations/pi/obsidian-agent-tools.test.ts
pnpm test
```

Expected: both pass.

---

### Task 6: Add Claude Code prompt-hook integration

**Files:**
- Create: `integrations/claude-code/on-user-prompt-submit`
- Create: `tests/integrations/claude-code/on-user-prompt-submit.test.ts`
- Modify: `README.md:120-128`

**Interfaces:**
- Consumes Claude Code hook JSON from stdin with `prompt`, `cwd`, and optional `session_id` fields.
- Produces a hook JSON response containing the rendered context as an additional prompt/system-context field accepted by the configured Claude Code hook protocol.
- On missing fields, timeout, or retrieval failure, returns a valid empty response and exit code zero.

- [ ] **Step 1: Confirm the installed Claude hook protocol before coding**

Inspect the locally installed Claude Code hook documentation and existing `integrations/claude-code/session-adapter.mjs`. Record the exact input and output field names in the test fixture. Do not assume the Pi `before_agent_start` response shape is valid for Claude Code.

- [ ] **Step 2: Write hook tests using the confirmed protocol**

Provide JSON fixtures for a prompt with `cwd` and for an empty prompt. Mock the context executable and assert the output uses the documented context-injection field, preserves the session identifier, and emits an empty valid response when the executable fails.

- [ ] **Step 3: Implement the hook**

Read stdin once, parse JSON, invoke `${OBSIDIAN_AGENT_CONTEXT:-$HOME/.local/bin/obsidian-agent-context}` with `--cwd` and the prompt using a timeout, and write exactly one JSON response. Never write the prompt or retrieved text to a persistent log. Use exit code zero for retrieval failures so memory remains advisory.

- [ ] **Step 4: Run hook tests**

Run:

```bash
pnpm test -- tests/integrations/claude-code/on-user-prompt-submit.test.ts
```

Expected: PASS.

---

### Task 7: Document operation, installation, and context controls

**Files:**
- Modify: `README.md:55-128`
- Modify: `module/AGENTS.md` if the always-on instructions need to mention the automatic adapter
- Modify: `module/skills/agent-memory/SKILL.md` only if the documented retrieval policy needs to distinguish automatic pre-turn retrieval from manual fallback

**Interfaces:**
- Documents the shared executable, Pi extension registration, Claude hook registration, tier order, default limits, and `OBSIDIAN_MEMORY_ENABLED=0` opt-out.

- [ ] **Step 1: Add the user-facing configuration table**

Document these exact defaults:

| Variable | Default | Purpose |
|---|---:|---|
| `OBSIDIAN_MEMORY_ENABLED` | enabled | Set to `0` to disable automatic injection |
| `OBSIDIAN_MEMORY_MAX_CHARS` | `16000` | Maximum rendered context size |
| `OBSIDIAN_MEMORY_MAX_RESULTS` | `3` | Maximum durable-memory candidates |
| `OBSIDIAN_MEMORY_PROJECT_RESULTS` | `2` | Maximum project candidates |
| `OBSIDIAN_MEMORY_BROAD_RESULTS` | `1` | Maximum broad-vault candidates |
| `OBSIDIAN_AGENT_CONTEXT` | `$HOME/.local/bin/obsidian-agent-context` | Shared retrieval executable |

- [ ] **Step 2: Document failure behavior and provenance**

State that automatic retrieval is advisory, retrieval errors do not block prompts, injected results contain source paths, and complete notes should be read only when exact details are needed.

- [ ] **Step 3: Run documentation-oriented checks**

Run:

```bash
rg -n "OBSIDIAN_MEMORY_ENABLED|OBSIDIAN_MEMORY_MAX_CHARS|obsidian-agent-context|before_agent_start" README.md module integrations
pnpm build
```

Expected: all documented names exist in source and the build passes.

---

### Task 8: Full self-review and regression verification

**Files:**
- Modify only files identified by earlier tasks if corrections are required.
- Test: all existing and new test files.

**Interfaces:**
- Verifies that retrieval is automatic, bounded, tiered, runtime-neutral, and failure-safe.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
pnpm test
pnpm build
```

Expected: all tests pass and the build exits successfully.

- [ ] **Step 2: Scan for unbounded or stale project paths**

Run:

```bash
rg -n "3_Resource/agent memory/projects|vault-search|memoryMaxChars|before_agent_start|on-user-prompt-submit" src tests integrations module README.md
```

Expected: no reference recreates `3_Resource/agent memory/projects/`; all automatic retrieval references use the shared bounded path.

- [ ] **Step 3: Verify the command manually with retrieval disabled**

Run:

```bash
OBSIDIAN_MEMORY_ENABLED=0 pnpm build
OBSIDIAN_MEMORY_ENABLED=0 node dist/cli.js memory-context "What should I do?"
```

Expected: no output and exit code zero.

- [ ] **Step 4: Verify a bounded manual retrieval**

Run:

```bash
OBSIDIAN_MEMORY_MAX_CHARS=1000 node dist/cli.js memory-context --project obsidian-agent-tools "How does agent memory work?"
```

Expected: Markdown context is returned, includes source paths, and is at most 1,000 characters.

- [ ] **Step 5: Perform the final plan self-review**

Confirm that every requested behavior has coverage:

- Durable memory is searched first.
- Project knowledge is searched under `1_Projects/`.
- Broader notes are conditional and bounded.
- Context is injected before Pi and Claude turns.
- A shared executable prevents runtime-specific retrieval divergence.
- Context has a hard size budget and provenance.
- Retrieval failures cannot block the agent.
- Existing session summarization remains unchanged.

Expected: no uncovered requirement, placeholder, undefined interface, or stale nested-project-memory path remains.
