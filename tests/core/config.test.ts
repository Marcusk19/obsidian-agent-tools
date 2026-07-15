import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";

describe("configuration", () => {
  it("uses neutral local defaults", () => {
    const config = loadConfig({ HOME: "/home/test" });
    expect(config.vaultPath).toBe("/home/test/obsidian-git-sync");
    expect(config.dataDir).toBe("/home/test/.local/share/obsidian-agent-tools");
    expect(config.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(config.summaryModel).toBe("qwen2.5:7b");
  });
});
