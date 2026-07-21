import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchVault } from "../search/vault-search.js";

function vaultPath(): string {
  return process.env.OBSIDIAN_VAULT || join(process.env.HOME || "/tmp", "obsidian-git-sync");
}

function dataDir(): string {
  return process.env.OBSIDIAN_DATA_DIR || join(process.env.HOME || "/tmp", ".local", "share", "obsidian-agent-tools");
}

export function registerVaultSearchTools(server: McpServer): void {
  server.tool(
    "obsidian_search_vault",
    "Search all Markdown notes using semantic retrieval followed by targeted keyword confirmation.",
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(10),
      rebuild: z.boolean().optional().default(false),
    },
    { readOnlyHint: true },
    async ({ query, limit, rebuild }) => {
      try {
        const results = await searchVault({ query, limit, rebuild, vaultPath: vaultPath(), dataDir: dataDir() });
        const text = results.length === 0
          ? "No matching notes found."
          : results.map((result, index) => [
              `**${index + 1}. ${result.title}** (${result.confidence})`,
              `Path: ${result.path}`,
              result.excerpt,
            ].join("\n")).join("\n\n---\n\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: `Vault search failed: ${message}` }], isError: true };
      }
    },
  );
}
