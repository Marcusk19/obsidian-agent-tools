import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerGraphTools(server: McpServer) {
  server.tool(
    "obsidian_graph",
    "Navigate the vault graph: backlinks, outgoing links, orphans (no incoming links), deadends (no outgoing links), or unresolved links",
    {
      action: z
        .enum(["backlinks", "links", "orphans", "deadends", "unresolved"])
        .describe("Graph action to perform"),
      file: z.string().optional().describe("File name (for backlinks/links)"),
      path: z.string().optional().describe("Exact file path"),
      total: z.boolean().optional().describe("Return count only"),
      verbose: z
        .boolean()
        .optional()
        .describe("Include additional details"),
      counts: z
        .boolean()
        .optional()
        .describe("Include link counts (for unresolved)"),
      all: z
        .boolean()
        .optional()
        .describe("Include non-markdown files (for orphans/deadends)"),
      format: z
        .enum(["json", "tsv", "csv"])
        .optional()
        .describe("Output format"),
    },
    { readOnlyHint: true },
    async ({ action, file, path, total, verbose, counts, all, format }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (file) args.file = file;
      if (path) args.path = path;
      if (total) args.total = true;
      if (verbose) args.verbose = true;
      if (counts) args.counts = true;
      if (all) args.all = true;
      if (format) args.format = format;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
