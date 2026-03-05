import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerReadTools(server: McpServer) {
  server.tool(
    "obsidian_read",
    "Read note contents, daily note, file info, or outline. Actions: read (note content), daily:read (today's daily note), daily:path (daily note path), outline (headings), file (file metadata)",
    {
      action: z
        .enum(["read", "daily:read", "daily:path", "outline", "file"])
        .describe("Read action to perform"),
      file: z.string().optional().describe("File name (wikilink-style)"),
      path: z.string().optional().describe("Exact file path"),
      format: z
        .enum(["tree", "md", "json"])
        .optional()
        .describe("Output format for outline"),
    },
    { readOnlyHint: true },
    async ({ action, file, path, format }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (file) args.file = file;
      if (path) args.path = path;
      if (format) args.format = format;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
