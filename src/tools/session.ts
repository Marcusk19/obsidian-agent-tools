import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execObsidian } from "../cli.js";

const SESSIONS_FILE = process.env.OBSIDIAN_SESSIONS_FILE || "claude-sessions.md";

export function registerSessionTools(server: McpServer) {
  server.tool(
    "obsidian_session",
    `Session management shortcuts for Claude Code workflows.
Use 'context' at the start of a session or when asked to "catch me up", "what are we working on", or "start work" — reads today's daily note, open tasks, and active sessions in one call.
Use 'morning' when asked for a "morning briefing", "start my day", or "daily kickoff" — reads recent daily notes, all open tasks, and project index for a structured agenda.
Returns structured markdown. No configuration required; uses OBSIDIAN_SESSIONS_FILE env var (default: claude-sessions.md) for session tracking.`,
    {
      action: z
        .enum(["context", "morning"])
        .describe("'context' for current session briefing, 'morning' for daily kickoff agenda"),
      days: z
        .number()
        .optional()
        .describe("For 'morning' action: how many recent daily notes to include (default 3)"),
    },
    { readOnlyHint: true },
    async ({ action, days }) => {
      const today = new Date().toISOString().slice(0, 10);

      if (action === "context") {
        const sections: string[] = [`## Session Context — ${today}`];

        // Active sessions file
        try {
          const sessionsContent = await execObsidian("read", { path: SESSIONS_FILE });
          sections.push(`### Active Sessions\n\n${sessionsContent.trim()}`);
        } catch {
          sections.push(`### Active Sessions\n\n(no sessions file found)`);
        }

        // Open tasks
        try {
          const tasks = await execObsidian("tasks", { todo: true });
          const taskLines = tasks.trim().split("\n").filter(Boolean);
          sections.push(`### Open Tasks (${taskLines.length} total)\n\n${tasks.trim()}`);
        } catch {
          sections.push(`### Open Tasks\n\n(could not read tasks)`);
        }

        // Today's daily note
        try {
          const daily = await execObsidian("daily:read", {});
          sections.push(`### Today's Daily Note\n\n${daily.trim()}`);
        } catch {
          sections.push(`### Today's Daily Note\n\n(no daily note yet)`);
        }

        return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
      }

      // morning action
      const numDays = Math.min(days ?? 3, 14);
      const sections: string[] = [`## Morning Briefing — ${today}`];

      // Recent daily notes
      try {
        let dailyPath: string;
        try {
          dailyPath = (await execObsidian("daily:path", {})).trim();
        } catch {
          dailyPath = "";
        }

        const dateMatch = dailyPath.match(/(\d{4}-\d{2}-\d{2})\.md$/);
        if (dateMatch) {
          const folder = dailyPath.slice(0, dailyPath.lastIndexOf("/"));
          const recentNotes: string[] = [];

          for (let i = 0; i < numDays; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const filePath = `${folder}/${dateStr}.md`;
            try {
              const content = await execObsidian("read", { path: filePath });
              recentNotes.push(`#### ${dateStr}\n\n${content.trim()}`);
            } catch {
              recentNotes.push(`#### ${dateStr}\n\n(no daily note found)`);
            }
          }

          sections.push(`### Recent Context\n\n${recentNotes.join("\n\n---\n\n")}`);
        } else {
          sections.push(`### Recent Context\n\n(could not determine daily note location)`);
        }
      } catch {
        sections.push(`### Recent Context\n\n(could not read recent daily notes)`);
      }

      // Open tasks
      try {
        const tasks = await execObsidian("tasks", { todo: true });
        const taskLines = tasks.trim().split("\n").filter(Boolean);
        sections.push(`### Open Tasks (${taskLines.length} total)\n\n${tasks.trim()}`);
      } catch {
        sections.push(`### Open Tasks\n\n(could not read tasks)`);
      }

      // Project index
      try {
        const projectIndex = await execObsidian("read", { path: "1_Projects/index.md" });
        sections.push(`### Projects Overview\n\n${projectIndex.trim()}`);
      } catch {
        // Skip silently — not everyone has this file
      }

      return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
    }
  );
}
