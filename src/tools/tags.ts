import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerTagsTools(server: McpServer) {
  server.tool(
    "obsidian_tags",
    "List tags in the vault or get info about a specific tag",
    {
      action: z
        .enum(["list", "get"])
        .describe("'list' for all tags, 'get' for a specific tag"),
      name: z
        .string()
        .optional()
        .describe("Tag name (required for 'get' action)"),
      file: z.string().optional().describe("Filter by file name"),
      path: z.string().optional().describe("Filter by file path"),
      total: z.boolean().optional().describe("Return count only"),
      counts: z.boolean().optional().describe("Include tag counts"),
      sort: z
        .enum(["name", "count"])
        .optional()
        .describe("Sort order"),
      verbose: z
        .boolean()
        .optional()
        .describe("Include file list (for 'get')"),
      format: z
        .enum(["json", "tsv", "csv"])
        .optional()
        .describe("Output format"),
    },
    { readOnlyHint: true },
    async ({ action, name, file, path, total, counts, sort, verbose, format }) => {
      const command = action === "get" ? "tag" : "tags";
      const args: Record<string, string | boolean | undefined> = {};
      if (name) args.name = name;
      if (file) args.file = file;
      if (path) args.path = path;
      if (total) args.total = true;
      if (counts) args.counts = true;
      if (sort) args.sort = sort;
      if (verbose) args.verbose = true;
      if (format) args.format = format;
      const result = await execObsidian(command, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
