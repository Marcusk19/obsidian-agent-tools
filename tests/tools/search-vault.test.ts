import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerVaultSearchTools } from "../../src/tools/search-vault.js";

describe("vault search MCP tool", () => {
  it("registers obsidian_search_vault", () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    registerVaultSearchTools(server);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(tools.obsidian_search_vault).toBeDefined();
  });
});
