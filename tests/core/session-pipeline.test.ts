import { describe, expect, it, vi } from "vitest";
import { createSessionPipeline } from "../../src/core/session-pipeline.js";

const input = {
  runtime: "pi" as const,
  sessionId: "s1",
  transcript: `[user]: ${"a".repeat(120)}\n\n[assistant]: ${"b".repeat(120)}`,
  cwd: "/tmp/project",
};

describe("session pipeline", () => {
  it("writes and indexes a locally generated summary", async () => {
    const writer = { append: vi.fn().mockResolvedValue("/vault/4_Archive/_agent_sessions/2026-07-15.md") };
    const index = vi.fn();
    const pipeline = createSessionPipeline({ summaryMaxChars: 50_000, summaryMinTurns: 2, summaryMinChars: 200 } as never, {
      ollama: { ensureModel: vi.fn().mockResolvedValue(undefined), summarize: vi.fn().mockResolvedValue({ topic: "Local summary", summary: "A concise handoff." }) },
      writer,
      embed: vi.fn().mockResolvedValue(null),
      index,
    });
    const result = await pipeline.process(input);
    expect(result?.path).toContain("_agent_sessions");
    expect(writer.append).toHaveBeenCalledOnce();
    expect(index).toHaveBeenCalledOnce();
  });

  it("preserves Markdown success when indexing fails", async () => {
    const writer = { append: vi.fn().mockResolvedValue("/vault/entry.md") };
    const pipeline = createSessionPipeline({ summaryMaxChars: 50_000, summaryMinTurns: 2, summaryMinChars: 200 } as never, {
      ollama: { ensureModel: vi.fn().mockResolvedValue(undefined), summarize: vi.fn().mockResolvedValue({ topic: "Local summary", summary: "A concise handoff." }) },
      writer,
      embed: vi.fn().mockResolvedValue(null),
      index: vi.fn(() => { throw new Error("database unavailable"); }),
    });
    await expect(pipeline.process(input)).resolves.toEqual({ path: "/vault/entry.md" });
  });
});
