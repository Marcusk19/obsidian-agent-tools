import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerPropertyWriteTools(server: McpServer) {
  server.tool(
    "obsidian_property_write",
    "Set or remove a property on a note",
    {
      action: z
        .enum(["set", "remove"])
        .describe("'set' to add/update, 'remove' to delete a property"),
      name: z.string().describe("Property name"),
      value: z
        .string()
        .optional()
        .describe("Property value (required for 'set')"),
      type: z
        .enum(["text", "list", "number", "checkbox", "date", "datetime"])
        .optional()
        .describe("Property type"),
      file: z.string().optional().describe("File name"),
      path: z.string().optional().describe("File path"),
    },
    { destructiveHint: true },
    async ({ action, name, value, type, file, path }) => {
      const command = action === "set" ? "property:set" : "property:remove";
      const args: Record<string, string | boolean | undefined> = { name };
      if (value) args.value = value;
      if (type) args.type = type;
      if (file) args.file = file;
      if (path) args.path = path;
      const result = await execObsidian(command, args);
      return { content: [{ type: "text" as const, text: result || "Done" }] };
    }
  );
}
