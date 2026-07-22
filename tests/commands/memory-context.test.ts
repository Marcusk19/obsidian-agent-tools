import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../src/core/config.js";
import { parseArgs, run } from "../../src/commands/memory-context.js";

function configStub(): AgentConfig {
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
  };
}

describe("obsidian-agent-context arguments", () => {
  it("parses scoped prompt options", () => {
    expect(parseArgs(["--project", "quay-operator", "What", "did", "we", "decide?"])).toEqual({
      project: "quay-operator",
      prompt: "What did we decide?",
    });
  });

  it("requires a prompt", () => {
    expect(() => parseArgs([])).toThrow("Usage: obsidian-agent-context");
  });
});

describe("obsidian-agent-context command", () => {
  it("swallows retrieval failures and produces no output", async () => {
    const stdout = { write: vi.fn() };
    const retrieve = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(run(["What", "now?"], {
      retrieve,
      loadConfig: () => configStub(),
      stdout: stdout as unknown as typeof process.stdout,
    })).resolves.toBeUndefined();

    expect(stdout.write).not.toHaveBeenCalled();
  });
});
