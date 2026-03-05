import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerTasksTools(server: McpServer) {
  server.tool(
    "obsidian_tasks",
    "List tasks in the vault. Filter by status (todo/done), file, or daily note",
    {
      filter: z
        .enum(["todo", "done"])
        .optional()
        .describe("Filter by task status"),
      file: z.string().optional().describe("Filter by file name"),
      path: z.string().optional().describe("Filter by file path"),
      daily: z.boolean().optional().describe("Show tasks from daily note"),
      total: z.boolean().optional().describe("Return count only"),
      verbose: z
        .boolean()
        .optional()
        .describe("Group by file with line numbers"),
      status: z
        .string()
        .optional()
        .describe("Filter by status character"),
      format: z
        .enum(["json", "tsv", "csv", "text"])
        .optional()
        .describe("Output format"),
    },
    { readOnlyHint: true },
    async ({ filter, file, path, daily, total, verbose, status, format }) => {
      const args: Record<string, string | boolean | undefined> = {};
      if (filter === "todo") args.todo = true;
      if (filter === "done") args.done = true;
      if (file) args.file = file;
      if (path) args.path = path;
      if (daily) args.daily = true;
      if (total) args.total = true;
      if (verbose) args.verbose = true;
      if (status) args.status = `"${status}"`;
      if (format) args.format = format;
      const result = await execObsidian("tasks", args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
