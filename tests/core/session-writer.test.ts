import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionWriter } from "../../src/core/session-writer.js";

describe("session writer", () => {
  it("creates and appends dated agent session files", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "agent-vault-"));
    const writer = createSessionWriter({ vaultPath } as never);
    const session = { runtime: "pi" as const, sessionId: "s1", transcript: "x", cwd: "/tmp" };
    const date = new Date("2026-07-15T10:30:00Z");
    const path = await writer.append(session, { topic: "First", summary: "First summary." }, date);
    await writer.append({ ...session, sessionId: "s2" }, { topic: "Second", summary: "Second summary." }, new Date("2026-07-15T11:00:00Z"));
    const content = await readFile(path, "utf8");
    expect(content).toContain("# Agent Sessions — 2026-07-15");
    expect(content).toContain("---");
    expect(content).toContain("**Session:** `s2`");
  });
});
