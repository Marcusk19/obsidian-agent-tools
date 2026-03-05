import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerVaultTools(server: McpServer) {
  server.tool(
    "obsidian_vault_info",
    "Get vault information: overview, file listing, folder listing, recent files, or bookmarks",
    {
      action: z
        .enum(["vault", "files", "folders", "recents", "bookmarks"])
        .describe("Which vault info to retrieve"),
      folder: z.string().optional().describe("Filter by folder path"),
      ext: z.string().optional().describe("Filter files by extension"),
      total: z
        .boolean()
        .optional()
        .describe("Return count instead of full list"),
    },
    { readOnlyHint: true },
    async ({ action, folder, ext, total }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (folder) args.folder = folder;
      if (ext) args.ext = ext;
      if (total) args.total = true;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
