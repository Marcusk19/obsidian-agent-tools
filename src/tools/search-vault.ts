import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig } from "../core/config.js";
import { formatVaultResults, searchVault } from "../search/vault-search.js";

export function registerVaultSearchTools(server: McpServer): void {
  server.tool(
    "obsidian_search_vault",
    "Search heading-aware Markdown chunks using merged keyword and semantic retrieval.",
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(10),
      rebuild: z.boolean().optional().default(false),
    },
    { readOnlyHint: true },
    async ({ query, limit, rebuild }) => {
      try {
        const config = loadConfig();
        const results = await searchVault({ query, limit, rebuild, vaultPath: config.vaultPath, dataDir: config.dataDir });
        const text = formatVaultResults(results);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Vault search failed: ${message}` }], isError: true };
      }
    },
  );
}
