import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../src/core/config.js";
import { retrieveMemoryContext } from "../../src/memory/retrieve.js";
import type { VaultSearchResult } from "../../src/search/vault-search.js";

let tempRoot = "";
afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = "";
});

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    vaultPath: "/vault",
    dataDir: "/data",
    ollamaHost: "http://127.0.0.1:11434",
    summaryModel: "qwen2.5:7b",
    summaryMaxChars: 50_000,
    summaryMinTurns: 2,
    summaryMinChars: 200,
    memoryMaxChars: 2_000,
    memoryMaxResults: 1,
    memoryProjectResults: 1,
    memoryBroadResults: 0,
    ...overrides,
  };
}

function result(path: string, confidence: "confirmed" | "semantic" = "confirmed"): VaultSearchResult {
  return {
    path,
    title: path.split("/").at(-1) || path,
    excerpt: "Use pnpm.",
    semanticScore: 0.1,
    keywordConfirmed: confidence === "confirmed",
    confidence,
  };
}

describe("retrieveMemoryContext", () => {
  it("uses a short durable query and does not broaden after a miss", async () => {
    const search = vi.fn().mockResolvedValue([]);

    const context = await retrieveMemoryContext(
      { prompt: "Could you help me refine the initial agent memory lookup?", maxChars: 2_000 },
      baseConfig(),
      { search },
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.any(String),
      pathPrefixes: ["3_Resource/agent memory/"],
      statuses: ["active"],
      semantic: false,
    }));
    const query = search.mock.calls[0][0].query as string;
    expect(query.split(/\s+/)).toHaveLength(3);
    expect(context.candidates).toEqual([]);
  });

  it("injects confirmed durable memories but skips semantic-only candidates", async () => {
    const search = vi.fn().mockResolvedValue([
      result("3_Resource/agent memory/semantic.md", "semantic"),
      result("3_Resource/agent memory/confirmed.md"),
    ]);

    const context = await retrieveMemoryContext(
      { prompt: "How should I install dependencies?", maxChars: 2_000 },
      baseConfig({ memoryMaxResults: 2 }),
      { search },
    );

    expect(context.candidates.map((candidate) => candidate.path)).toEqual([
      "3_Resource/agent memory/confirmed.md",
    ]);
  });

  it("scopes project retrieval to the repository inferred from cwd", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "memory-retrieve-test-"));
    const repository = join(tempRoot, "obsidian-agent-tools");
    const nested = join(repository, "src", "memory");
    mkdirSync(join(repository, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([result("1_Projects/obsidian-agent-tools.md", "semantic")]);

    const context = await retrieveMemoryContext(
      { prompt: "How should this repository run tests?", cwd: nested, maxChars: 2_000 },
      baseConfig(),
      { search },
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pathPrefixes: ["1_Projects/obsidian-agent-tools"],
    }));
    expect(context.candidates.map((candidate) => candidate.tier)).toEqual(["project"]);
  });

  it("searches broad notes only for explicit recall intent when enabled", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([result("4_Archive/_daily_notes/2026-07-21.md")]);

    const context = await retrieveMemoryContext(
      { prompt: "What did I decide yesterday?", maxChars: 2_000 },
      baseConfig({ memoryBroadResults: 1 }),
      { search },
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(context.candidates.map((candidate) => candidate.tier)).toEqual(["broad"]);
  });
});
