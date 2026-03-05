import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerManageTools(server: McpServer) {
  server.tool(
    "obsidian_manage",
    "Move, rename, or delete a note",
    {
      action: z.enum(["move", "rename", "delete"]).describe("Action to perform"),
      file: z.string().optional().describe("File name"),
      path: z.string().optional().describe("File path"),
      to: z
        .string()
        .optional()
        .describe("Destination folder or path (for move)"),
      name: z.string().optional().describe("New file name (for rename)"),
      permanent: z
        .boolean()
        .optional()
        .describe("Skip trash, delete permanently"),
    },
    { destructiveHint: true },
    async ({ action, file, path, to, name, permanent }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (file) args.file = file;
      if (path) args.path = path;
      if (to) args.to = to;
      if (name) args.name = name;
      if (permanent) args.permanent = true;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result || "Done" }] };
    }
  );
}
