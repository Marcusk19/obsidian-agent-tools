import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { searchHybrid } from "../search/hybrid.js";

export function registerSearchSessionsTools(server: McpServer) {
  server.tool(
    "obsidian_search_sessions",
    "Search past Claude Code session summaries using hybrid keyword + semantic search. Use this to find previous conversations by topic, code area, or concept.",
    {
      query: z.string().describe("Search query text"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max results to return (default 10)"),
      days: z
        .number()
        .optional()
        .default(0)
        .describe("Limit to last N days (0 = all time)"),
    },
    { readOnlyHint: true },
    async ({ query, limit, days }) => {
      try {
        const db = getDb();
        const results = await searchHybrid(db, query, limit, days);

        if (results.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No matching sessions found." },
            ],
          };
        }

        const formatted = results
          .map((r, i) => {
            const cwd = r.cwd || "unknown";
            return [
              `**${i + 1}. ${r.topic}** (${r.date}, score: ${r.rrfScore.toFixed(4)})`,
              r.content,
              `*CWD: ${cwd}*`,
            ].join("\n");
          })
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
