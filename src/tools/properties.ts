import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerPropertiesTools(server: McpServer) {
  server.tool(
    "obsidian_properties",
    "List properties in the vault or read a specific property value from a file",
    {
      action: z
        .enum(["list", "read"])
        .describe("'list' for all properties, 'read' for a specific property value"),
      name: z
        .string()
        .optional()
        .describe("Property name (required for 'read')"),
      file: z.string().optional().describe("File name"),
      path: z.string().optional().describe("File path"),
      total: z.boolean().optional().describe("Return count only"),
      counts: z.boolean().optional().describe("Include occurrence counts"),
      sort: z.enum(["name", "count"]).optional().describe("Sort order"),
      format: z
        .enum(["yaml", "json", "tsv"])
        .optional()
        .describe("Output format"),
    },
    { readOnlyHint: true },
    async ({ action, name, file, path, total, counts, sort, format }) => {
      const command = action === "read" ? "property:read" : "properties";
      const args: Record<string, string | boolean | undefined> = {};
      if (name) args.name = name;
      if (file) args.file = file;
      if (path) args.path = path;
      if (total) args.total = true;
      if (counts) args.counts = true;
      if (sort) args.sort = sort;
      if (format) args.format = format;
      const result = await execObsidian(command, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
