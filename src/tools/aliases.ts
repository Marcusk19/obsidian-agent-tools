import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerAliasesTools(server: McpServer) {
  server.tool(
    "obsidian_aliases",
    "List aliases in the vault",
    {
      file: z.string().optional().describe("Filter by file name"),
      path: z.string().optional().describe("Filter by file path"),
      total: z.boolean().optional().describe("Return count only"),
      verbose: z.boolean().optional().describe("Include file paths"),
    },
    { readOnlyHint: true },
    async ({ file, path, total, verbose }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (file) args.file = file;
      if (path) args.path = path;
      if (total) args.total = true;
      if (verbose) args.verbose = true;
      const result = await execObsidian("aliases", args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
