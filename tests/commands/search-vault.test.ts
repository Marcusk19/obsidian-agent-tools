import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/commands/search-vault.js";

describe("obsidian-agent-search arguments", () => {
  it("parses the vault query", () => {
    expect(parseArgs(["vault", "explicit vault selector"])).toEqual({
      command: "vault",
      query: "explicit vault selector",
      limit: 10,
      rebuild: false,
    });
  });

  it("parses limit and rebuild flags", () => {
    expect(parseArgs(["vault", "--limit", "5", "--rebuild", "query", "terms"])).toEqual({
      command: "vault",
      query: "query terms",
      limit: 5,
      rebuild: true,
    });
  });

  it("rejects invalid invocations", () => {
    expect(() => parseArgs(["search", "query"])).toThrow("Usage");
    expect(() => parseArgs(["vault", "--limit", "0", "query"])).toThrow("--limit");
    expect(() => parseArgs(["vault", "--unknown", "query"])).toThrow("Unknown option");
  });
});
