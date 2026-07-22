import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";

interface ContentBlock { type: string; text?: string }
interface SessionEntry { type: string; timestamp?: string; message?: { role?: string; content?: string | ContentBlock[] } }

function log(message: string): void {
  try {
    const dir = join(process.env.HOME || "/tmp", ".local", "share", "obsidian-agent-tools");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "pi-extension.log"), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Diagnostics are best effort.
  }
}

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

function memoryTimeoutMs(): number {
  const configured = Number(process.env.OBSIDIAN_MEMORY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 5_000;
}

async function runMemoryContext(prompt: string, cwd?: string): Promise<string> {
  const executable = process.env.OBSIDIAN_AGENT_CONTEXT || join(process.env.HOME || "/tmp", ".local", "bin", "obsidian-agent-context");
  const args = [] as string[];
  if (cwd) {
    args.push("--cwd", cwd);
  }
  args.push(prompt);
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: memoryTimeoutMs(), maxBuffer: 20_000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export default function obsidianAgentTools(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    if (process.env.OBSIDIAN_MEMORY_ENABLED === "0") return;
    const prompt = (event as { prompt?: string }).prompt?.trim();
    if (!prompt) return;
    try {
      const output = await runMemoryContext(prompt, ctx.cwd);
      const content = output.trim();
      if (!content) return;
      return {
        message: {
          customType: "obsidian-memory",
          content,
          display: false,
        },
      };
    } catch (error) {
      log(`memory retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    try {
      const reason = (event as { reason?: string }).reason;
      log(`shutdown reason=${reason}`);
      if (reason !== "quit") return;
      const branch = ctx.sessionManager.getBranch() as SessionEntry[];
      const transcript = buildPiTranscript(branch);
      if (!transcript) {
        log("skipping: session too short or branch had no user/assistant text");
        return;
      }
      const directory = join(tmpdir(), `obsidian-agent-tools-${randomBytes(6).toString("hex")}`);
      mkdirSync(directory, { recursive: true });
      const file = join(directory, "session.json");
      writeFileSync(file, JSON.stringify({
        runtime: "pi",
        sessionId: basename(ctx.sessionManager.getSessionFile?.() || "unknown", ".jsonl"),
        transcript,
        cwd: ctx.cwd,
        startedAt: branch.find((entry) => entry.timestamp)?.timestamp,
        endedAt: new Date().toISOString(),
      }));
      const executable = process.env.OBSIDIAN_AGENT_SUMMARIZER || join(process.env.HOME || "/tmp", ".local", "bin", "obsidian-agent-summarize");
      const child = spawn(executable, [file], { detached: true, stdio: "ignore", env: { ...process.env } });
      child.unref();
      log(`spawned summarizer for ${file}`);
    } catch (error) {
      log(`shutdown error: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
  });
}
