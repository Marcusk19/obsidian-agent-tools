import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerTaskUpdateTools(server: McpServer) {
  server.tool(
    "obsidian_task_update",
    "Toggle, complete, or uncomplete a task",
    {
      action: z
        .enum(["toggle", "done", "todo"])
        .describe("Task action: toggle, mark done, or mark todo"),
      file: z.string().optional().describe("File name"),
      path: z.string().optional().describe("File path"),
      line: z.number().optional().describe("Line number of the task"),
      ref: z
        .string()
        .optional()
        .describe("Task reference (path:line)"),
      daily: z.boolean().optional().describe("Target daily note"),
      status: z
        .string()
        .optional()
        .describe("Set status character"),
    },
    { destructiveHint: true },
    async ({ action, file, path, line, ref, daily, status }) => {
      const args: Record<string, string | boolean | number | undefined> = {};
      if (action === "toggle") args.toggle = true;
      if (action === "done") args.done = true;
      if (action === "todo") args.todo = true;
      if (file) args.file = file;
      if (path) args.path = path;
      if (line) args.line = line;
      if (ref) args.ref = ref;
      if (daily) args.daily = true;
      if (status) args.status = `"${status}"`;
      const result = await execObsidian("task", args);
      return { content: [{ type: "text" as const, text: result || "Done" }] };
    }
  );
}
