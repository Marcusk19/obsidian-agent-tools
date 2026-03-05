import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerWriteTools(server: McpServer) {
  server.tool(
    "obsidian_write",
    "Create a new note, or append/prepend content to a note or daily note",
    {
      action: z
        .enum(["create", "append", "prepend", "daily:append", "daily:prepend"])
        .describe("Write action to perform"),
      content: z.string().describe("Content to write"),
      file: z
        .string()
        .optional()
        .describe("File name (for append/prepend)"),
      path: z
        .string()
        .optional()
        .describe("File path (for append/prepend/create)"),
      name: z.string().optional().describe("File name (for create)"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite if file exists (for create)"),
      template: z
        .string()
        .optional()
        .describe("Template to use (for create)"),
      inline: z
        .boolean()
        .optional()
        .describe("Append/prepend without newline"),
    },
    { destructiveHint: true },
    async ({ action, content, file, path, name, overwrite, template, inline }) => {
      const args: Record<string, string | boolean | undefined> = { content };
      if (file) args.file = file;
      if (path) args.path = path;
      if (name) args.name = name;
      if (overwrite) args.overwrite = true;
      if (template) args.template = template;
      if (inline) args.inline = true;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result || "Done" }] };
    }
  );
}
