import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";

describe("configuration", () => {
  it("uses neutral local defaults", () => {
    const config = loadConfig({ HOME: "/home/test" });
    expect(config.vaultPath).toBe("/home/test/obsidian-git-sync");
    expect(config.dataDir).toBe("/home/test/.local/share/obsidian-agent-tools");
    expect(config.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(config.summaryModel).toBe("qwen2.5:7b");
    expect(config.memoryMaxChars).toBe(2_000);
    expect(config.memoryMaxResults).toBe(1);
    expect(config.memoryProjectResults).toBe(1);
    expect(config.memoryBroadResults).toBe(0);
  });

  it("loads bounded automatic memory retrieval settings", () => {
    const config = loadConfig({
      HOME: "/home/test",
      OBSIDIAN_MEMORY_MAX_CHARS: "12000",
      OBSIDIAN_MEMORY_MAX_RESULTS: "4",
      OBSIDIAN_MEMORY_PROJECT_RESULTS: "2",
      OBSIDIAN_MEMORY_BROAD_RESULTS: "0",
    });

    expect(config.memoryMaxChars).toBe(12000);
    expect(config.memoryMaxResults).toBe(4);
    expect(config.memoryProjectResults).toBe(2);
    expect(config.memoryBroadResults).toBe(0);
  });
});
