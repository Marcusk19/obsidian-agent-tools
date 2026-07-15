import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

interface ContentBlock { type: string; text?: string }
interface SessionEntry { type: string; message?: { role?: string; content?: string | ContentBlock[] } }

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text" && block.text).map((block) => block.text!).join("\n\n");
}

export function buildPiTranscript(entries: SessionEntry[]): string | null {
  const turns = entries
    .filter((entry) => entry.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant"))
    .map((entry) => `[${entry.message!.role}]: ${textOf(entry.message!.content).trim()}`)
    .filter((turn) => !turn.endsWith("]:"));
  const transcript = turns.join("\n\n");
  if (turns.length < 2 || transcript.length < 200) return null;
  return transcript.length > 50_000 ? `${transcript.slice(0, 50_000)}\n\n[...truncated]` : transcript;
}

export default function obsidianAgentTools(pi: ExtensionAPI): void {
  pi.on("session_shutdown", async (event, ctx) => {
    try {
      if ((event as { reason?: string }).reason !== "quit") return;
      const transcript = buildPiTranscript(ctx.sessionManager.getBranch() as SessionEntry[]);
      if (!transcript) return;
      const directory = join(tmpdir(), `obsidian-agent-tools-${randomBytes(6).toString("hex")}`);
      mkdirSync(directory, { recursive: true });
      const file = join(directory, "session.json");
      writeFileSync(file, JSON.stringify({
        runtime: "pi",
        sessionId: ctx.sessionManager.getSessionId?.() || "unknown",
        transcript,
        cwd: ctx.cwd,
      }));
      const executable = process.env.OBSIDIAN_AGENT_SUMMARIZER || "obsidian-agent-summarize";
      const child = spawn(executable, [file], { detached: true, stdio: "ignore", env: { ...process.env } });
      child.unref();
    } catch {
      // Session shutdown integration is best effort.
    }
  });
}
