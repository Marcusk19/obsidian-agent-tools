import { homedir } from "node:os";
import type { AgentConfig } from "./config.js";

export interface NormalizedSession {
  runtime: "claude-code" | "pi";
  sessionId: string;
  transcript: string;
  cwd: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SummaryResult {
  topic: string;
  summary: string;
}

export function validateNormalizedSession(value: unknown): NormalizedSession {
  if (!value || typeof value !== "object") throw new Error("session input must be an object");
  const input = value as Record<string, unknown>;
  if (input.runtime !== "claude-code" && input.runtime !== "pi") {
    throw new Error("session runtime must be claude-code or pi");
  }
  for (const key of ["sessionId", "transcript", "cwd"]) {
    if (typeof input[key] !== "string" || !(input[key] as string).trim()) {
      throw new Error(`session ${key} is required`);
    }
  }
  return {
    runtime: input.runtime,
    sessionId: (input.sessionId as string).trim(),
    transcript: input.transcript as string,
    cwd: (input.cwd as string).trim(),
    startedAt: typeof input.startedAt === "string" ? input.startedAt : undefined,
    endedAt: typeof input.endedAt === "string" ? input.endedAt : undefined,
  };
}

export function formatTranscript(
  transcript: string,
  config: Pick<AgentConfig, "summaryMaxChars" | "summaryMinTurns" | "summaryMinChars">,
): string | null {
  const text = transcript.trim();
  const turns = text.split(/\n\s*\n/).filter((part) => /^\[(user|assistant)\]:/m.test(part));
  if (turns.length < config.summaryMinTurns || text.length < config.summaryMinChars) return null;
  if (text.length <= config.summaryMaxChars) return text;
  return `${text.slice(0, config.summaryMaxChars).trimEnd()}\n\n[...truncated]`;
}

export function shortenCwd(cwd: string, home = process.env.HOME || homedir()): string {
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

export function parseSummaryResponse(text: string): SummaryResult | null {
  const taggedTopic = text.match(/<topic>\s*([\s\S]*?)\s*<\/topic>/i)?.[1]?.trim();
  const taggedSummary = text.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i)?.[1]?.trim();
  const cleaned = text.replace(/<\/?(?:topic|summary)>/gi, "").trim();
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const topic = taggedTopic || lines[0];
  let summary = taggedSummary || lines.slice(1).join(" ").trim();
  if (summary === topic) summary = "";
  if (!topic || !summary || topic.length > 60) return null;
  if (/^#{1,6}\s|```/m.test(summary)) return null;
  return { topic, summary };
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatDuration(startedAt: string, endedAt: string): string | null {
  const milliseconds = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 1) return `${Math.floor(milliseconds / 1_000)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function renderSessionEntry(
  session: NormalizedSession,
  result: SummaryResult,
  time: string,
): string {
  const timing = session.startedAt && session.endedAt
    ? `\n**Started:** \`${formatTimestamp(session.startedAt)}\`\n**Ended:** \`${formatTimestamp(session.endedAt)}\`${formatDuration(session.startedAt, session.endedAt) ? `\n**Duration:** \`${formatDuration(session.startedAt, session.endedAt)}\`` : ""}`
    : "";
  return `### ${time} — ${result.topic}\n\n${result.summary}\n\n**Runtime:** \`${session.runtime}\`\n**Session:** \`${session.sessionId}\`${timing}\n**CWD:** \`${shortenCwd(session.cwd)}\`\n`;
}
