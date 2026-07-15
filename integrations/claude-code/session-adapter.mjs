#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const input = JSON.parse(readFileSync(0, "utf8"));
const transcriptPath = input.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

const turns = [];
for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
  try {
    const entry = JSON.parse(line);
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const message = entry.message;
    if (!message) continue;
    const content = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n\n")
        : "";
    if (content.trim()) turns.push(`[${entry.type}]: ${content.trim()}`);
  } catch {
    // Ignore malformed JSONL records.
  }
}

const transcript = turns.join("\n\n");
if (turns.length < 2 || transcript.length < 200) process.exit(0);
const normalized = {
  runtime: "claude-code",
  sessionId: input.session_id || "unknown",
  transcript: transcript.length > 50_000 ? `${transcript.slice(0, 50_000)}\n\n[...truncated]` : transcript,
  cwd: input.cwd || process.cwd(),
};

const directory = mkdtempSync(join(tmpdir(), "obsidian-agent-tools-"));
const file = join(directory, "session.json");
writeFileSync(file, JSON.stringify(normalized));
const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executable = process.env.OBSIDIAN_AGENT_SUMMARIZER || join(repoDir, "bin", "obsidian-agent-summarize");
const child = spawn(executable, [file], { detached: true, stdio: "ignore", env: process.env });
child.unref();
