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
Use 'seed' when asked to "give me context on X", "what do I know about X", "background on X", "related notes for X", or "deep dive on X" — reads the seed note, follows backlinks and/or outgoing links, and returns compiled context from linked notes.
Returns structured markdown. No configuration required; uses OBSIDIAN_SESSIONS_FILE env var (default: claude-sessions.md) for session tracking.`,
    {
      action: z
        .enum(["context", "morning", "seed"])
        .describe("'context' for session briefing, 'morning' for daily kickoff, 'seed' for graph-based context from a note"),
      days: z
        .number()
        .optional()
        .describe("For 'morning' action: how many recent daily notes to include (default 3)"),
      file: z
        .string()
        .optional()
        .describe("For 'seed' action: seed note name (wikilink-style, e.g. 'My Note')"),
      path: z
        .string()
        .optional()
        .describe("For 'seed' action: exact file path (alternative to file)"),
      depth: z
        .number()
        .optional()
        .describe("For 'seed' action: traversal hops, 1 or 2 (default 1, max 2)"),
      max_notes: z
        .number()
        .optional()
        .describe("For 'seed' action: max linked notes to read (default 10, max 20)"),
      include: z
        .enum(["backlinks", "links", "both"])
        .optional()
        .describe("For 'seed' action: which link direction to follow (default 'both')"),
    },
    { readOnlyHint: true },
    async ({ action, days, file, path, depth, max_notes, include }) => {
      const today = new Date().toISOString().slice(0, 10);

      if (action === "seed") {
        if (!file && !path) {
          return {
            content: [{ type: "text" as const, text: "Error: 'seed' action requires either 'file' or 'path' parameter." }],
            isError: true,
          };
        }

        const readArg = file ? { file } : { path: path! };
        const seedLabel = file || path!;
        const maxDepth = Math.min(Math.max(depth ?? 1, 1), 2);
        const budget = Math.min(Math.max(max_notes ?? 10, 1), 20);
        const direction = include ?? "both";
        const seen = new Set<string>();
        let notesRead = 0;

        const sections: string[] = [`## Graph Context — [[${seedLabel}]]`];

        // Read seed note
        try {
          const seedContent = await execObsidian("read", readArg);
          sections.push(`### Seed Note\n\n${seedContent.trim()}`);
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error: could not read seed note '${seedLabel}'.` }],
            isError: true,
          };
        }

        // Helper to read a list of notes within budget
        const readNotes = async (paths: string[]): Promise<string[]> => {
          const results: string[] = [];
          for (const p of paths) {
            if (notesRead >= budget) break;
            if (seen.has(p)) continue;
            seen.add(p);
            try {
              const content = await execObsidian("read", { path: p });
              results.push(`#### ${p}\n\n${content.trim()}`);
              notesRead++;
            } catch {
              results.push(`#### ${p}\n\n(could not read)`);
            }
          }
          return results;
        };

        // Parse CLI output into path list (one path per line)
        const parsePaths = (output: string): string[] =>
          output.trim().split("\n").map(l => l.trim()).filter(Boolean);

        let backlinkPaths: string[] = [];
        let outlinkPaths: string[] = [];

        // Get backlinks
        if (direction === "backlinks" || direction === "both") {
          try {
            const raw = await execObsidian("backlinks", readArg);
            backlinkPaths = parsePaths(raw);
          } catch {
            // no backlinks
          }
        }

        // Get outgoing links
        if (direction === "links" || direction === "both") {
          try {
            const raw = await execObsidian("links", readArg);
            outlinkPaths = parsePaths(raw);
          } catch {
            // no outgoing links
          }
        }

        // Read backlinked notes
        if (backlinkPaths.length > 0) {
          const notes = await readNotes(backlinkPaths);
          sections.push(`### Backlinks (${notes.length} notes)\n\n${notes.join("\n\n")}`);
        }

        // Read outgoing linked notes
        if (outlinkPaths.length > 0) {
          const notes = await readNotes(outlinkPaths);
          if (notes.length > 0) {
            sections.push(`### Outgoing Links (${notes.length} notes)\n\n${notes.join("\n\n")}`);
          }
        }

        // Depth 2: follow outgoing links from depth-1 notes
        if (maxDepth >= 2 && notesRead < budget) {
          const depth1Paths = [...new Set([...backlinkPaths, ...outlinkPaths])];
          const depth2Results: string[] = [];

          for (const d1Path of depth1Paths) {
            if (notesRead >= budget) break;
            try {
              const raw = await execObsidian("links", { path: d1Path });
              const d2Paths = parsePaths(raw);
              const notes = await readNotes(d2Paths);
              depth2Results.push(...notes);
            } catch {
              // skip
            }
          }

          if (depth2Results.length > 0) {
            sections.push(`### Extended Context — Depth 2 (${depth2Results.length} notes)\n\n${depth2Results.join("\n\n")}`);
          }
        }

        sections.push(`---\n*Context seeded from ${notesRead} linked notes (depth ${maxDepth}, max ${budget})*`);

        return { content: [{ type: "text" as const, text: sections.join("\n\n") }] };
      }

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
