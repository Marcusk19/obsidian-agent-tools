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
    expect(config.memoryDurableDir).toBe("3_Resource/agent memory/");
    expect(config.projectsDir).toBe("1_Projects");
    expect(config.vaultSections).toEqual(["1_Projects/", "2_Areas/", "3_Resource/", "4_Archive/"]);
    expect(config.sessionsDir).toBe("4_Archive/_agent_sessions");
  });

  it("loads custom vault structure settings", () => {
    const config = loadConfig({
      HOME: "/home/test",
      OBSIDIAN_MEMORY_DURABLE_DIR: "Resources/memories/",
      OBSIDIAN_PROJECTS_DIR: "Projects",
      OBSIDIAN_VAULT_SECTIONS: "Projects/,Notes/",
      OBSIDIAN_SESSIONS_DIR: "Archive/sessions",
    });

    expect(config.memoryDurableDir).toBe("Resources/memories/");
    expect(config.projectsDir).toBe("Projects");
    expect(config.vaultSections).toEqual(["Projects/", "Notes/"]);
    expect(config.sessionsDir).toBe("Archive/sessions");
  });

  it("treats empty OBSIDIAN_VAULT_SECTIONS as whole-vault search", () => {
    const config = loadConfig({ HOME: "/home/test", OBSIDIAN_VAULT_SECTIONS: "" });
    expect(config.vaultSections).toEqual([]);
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
