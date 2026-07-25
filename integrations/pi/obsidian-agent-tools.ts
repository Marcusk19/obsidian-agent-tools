import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGED_CONTEXT_EXECUTABLE = fileURLToPath(new URL("../../bin/obsidian-agent-context", import.meta.url));
const PACKAGED_SEARCH_EXECUTABLE = fileURLToPath(new URL("../../bin/obsidian-agent-search", import.meta.url));
const PACKAGED_SUMMARIZER_EXECUTABLE = fileURLToPath(new URL("../../bin/obsidian-agent-summarize", import.meta.url));
const MEMORY_SYSTEM_PROMPT = `# Obsidian Agent Memory

Automatic memory-context injection satisfies routine retrieval. Apply injected guidance only within its recorded scope. Use the agent-memory skill for deeper retrieval, exact source reads, or memory maintenance. Capture explicit corrections, durable preferences, and reusable failures autonomously. Never store secrets or sensitive data, and verify every memory write by reading it back before claiming success.`;

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
  const executable = process.env.OBSIDIAN_AGENT_CONTEXT || PACKAGED_CONTEXT_EXECUTABLE;
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
  pi.registerCommand("obsidian-bootstrap", {
    description: "Install the embedding model and rebuild the local Obsidian vector index",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("obsidian-bootstrap", "Checking Ollama...");
      try {
        const list = await pi.exec("ollama", ["list"], { timeout: 15_000 });
        if (list.code !== 0) {
          const details = list.stderr.trim() || list.stdout.trim() || `exit code ${list.code}`;
          ctx.ui.notify(`Ollama is unavailable: ${details}`, "error");
          return;
        }

        const hasEmbeddingModel = list.stdout
          .split("\n")
          .some((line) => line.trim().split(/\s+/, 1)[0]?.startsWith("nomic-embed-text:"));
        if (!hasEmbeddingModel) {
          ctx.ui.setStatus("obsidian-bootstrap", "Pulling nomic-embed-text...");
          const pull = await pi.exec("ollama", ["pull", "nomic-embed-text"], { timeout: 15 * 60_000 });
          if (pull.code !== 0) {
            const details = pull.stderr.trim() || pull.stdout.trim() || `exit code ${pull.code}`;
            ctx.ui.notify(`Could not install nomic-embed-text: ${details}`, "error");
            return;
          }
        }

        ctx.ui.setStatus("obsidian-bootstrap", "Rebuilding the Obsidian index...");
        const index = await pi.exec(
          PACKAGED_SEARCH_EXECUTABLE,
          ["vault", "--rebuild", "agent memory"],
          { timeout: 30 * 60_000 },
        );
        if (index.code !== 0) {
          const details = index.stderr.trim() || index.stdout.trim() || `exit code ${index.code}`;
          ctx.ui.notify(`Could not build the Obsidian index: ${details}`, "error");
          return;
        }

        ctx.ui.notify("Obsidian vector index is ready.", "info");
      } catch (error) {
        ctx.ui.notify(`Obsidian bootstrap failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      } finally {
        ctx.ui.setStatus("obsidian-bootstrap", undefined);
      }
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (process.env.OBSIDIAN_MEMORY_ENABLED === "0") return;
    const prompt = (event as { prompt?: string }).prompt?.trim();
    if (!prompt) return;
    const systemPrompt = `${event.systemPrompt}\n\n${MEMORY_SYSTEM_PROMPT}`;
    try {
      const output = await runMemoryContext(prompt, ctx.cwd);
      const content = output.trim();
      if (!content) return { systemPrompt };
      return {
        message: {
          customType: "obsidian-memory",
          content,
          display: false,
        },
        systemPrompt,
      };
    } catch (error) {
      log(`memory retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
      return { systemPrompt };
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
      const executable = process.env.OBSIDIAN_AGENT_SUMMARIZER || PACKAGED_SUMMARIZER_EXECUTABLE;
      const child = spawn(executable, [file], { detached: true, stdio: "ignore", env: { ...process.env } });
      child.unref();
      log(`spawned summarizer for ${file}`);
    } catch (error) {
      log(`shutdown error: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
  });
}
