import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

export function registerReadTools(server: McpServer) {
  server.tool(
    "obsidian_read",
    "Read note contents, daily note, file info, or outline. Actions: read (note content), daily:read (today's daily note), daily:path (daily note path), daily:recent (last N daily notes for cross-session context), outline (headings), file (file metadata)",
    {
      action: z
        .enum(["read", "daily:read", "daily:path", "daily:recent", "outline", "file"])
        .describe("Read action to perform"),
      file: z.string().optional().describe("File name (wikilink-style)"),
      path: z.string().optional().describe("Exact file path"),
      format: z
        .enum(["tree", "md", "json"])
        .optional()
        .describe("Output format for outline"),
      days: z
        .number()
        .optional()
        .describe("Number of recent daily notes to return (default 3, max 14). Used with daily:recent action."),
    },
    { readOnlyHint: true },
    async ({ action, file, path, format, days }) => {
      if (action === "daily:recent") {
        const numDays = Math.min(days ?? 3, 14);

        // Get today's daily note path to extract folder and date format
        let dailyPath: string;
        try {
          dailyPath = (await execObsidian("daily:path", {})).trim();
        } catch {
          return { content: [{ type: "text" as const, text: "(could not determine daily note path)" }] };
        }

        // Extract the date portion — expect a filename like "2026-03-08.md" somewhere in the path
        const dateMatch = dailyPath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
        if (!dateMatch) {
          return { content: [{ type: "text" as const, text: `(unexpected daily note path format: ${dailyPath})` }] };
        }

        const folder = dailyPath.slice(0, dailyPath.lastIndexOf("/"));
        const sections: string[] = [];

        for (let i = 0; i < numDays; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
          const filePath = `${folder}/${dateStr}.md`;

          try {
            const content = await execObsidian("read", { path: filePath });
            sections.push(`## ${dateStr}\n\n${content.trim()}`);
          } catch {
            sections.push(`## ${dateStr}\n\n(no daily note found)`);
          }
        }

        return { content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }] };
      }

      const args: Record<string, string | boolean | undefined> = {};
      if (file) args.file = file;
      if (path) args.path = path;
      if (format) args.format = format;
      const result = await execObsidian(action, args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );
}
