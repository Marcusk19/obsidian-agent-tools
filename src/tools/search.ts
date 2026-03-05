import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerSearchTools(server: McpServer) {
  server.tool(
    "obsidian_search",
    "Search the vault for text. Use context=true to include matching line context",
    {
      query: z.string().describe("Search query text"),
      context: z
        .boolean()
        .optional()
        .describe("Include matching line context (uses search:context)"),
      path: z.string().optional().describe("Limit search to folder"),
      limit: z.number().optional().describe("Max files to return"),
      case_sensitive: z.boolean().optional().describe("Case sensitive search"),
      total: z.boolean().optional().describe("Return match count only"),
      format: z
        .enum(["text", "json"])
        .optional()
        .describe("Output format"),
    },
    { readOnlyHint: true },
    async ({ query, context, path, limit, case_sensitive, total, format }) => {
      const command = context ? "search:context" : "search";
      const args: Record<string, string | boolean | number | undefined> = {
        query,
      };
      if (path) args.path = path;
      if (limit) args.limit = limit;
      if (case_sensitive) args.case = true;
      if (total) args.total = true;
      if (format) args.format = format;
      const result = await execObsidian(command, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
