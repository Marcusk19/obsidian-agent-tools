import { readFileSync } from "node:fs";

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

const MIN_TURNS = 2; // at least 1 user + 1 assistant
const MIN_TOTAL_CHARS = 200;

/**
 * Parse a Claude Code JSONL transcript file into conversation turns.
 *
 * Extracts user and assistant text content, skipping tool_use/tool_result/thinking blocks.
 * Returns null if the session is too short to be worth summarizing.
 */
export function parseTranscript(path: string): TranscriptTurn[] | null {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const turns: TranscriptTurn[] = [];

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.message) continue;

    const role = entry.type as "user" | "assistant";
    const { content: msgContent } = entry.message;

    if (typeof msgContent === "string") {
      // User messages have content as a plain string
      const text = msgContent.trim();
      if (text) turns.push({ role, text });
    } else if (Array.isArray(msgContent)) {
      // Assistant messages have content as an array of blocks
      const textParts: string[] = [];
      for (const block of msgContent) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        }
      }
      const text = textParts.join("\n\n").trim();
      if (text) turns.push({ role, text });
    }
  }

  // Filter trivial sessions
  const totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);

  if (turns.length < MIN_TURNS || totalChars < MIN_TOTAL_CHARS) {
    return null;
  }

  return turns;
}

/**
 * Format transcript turns into a single string for the summarization prompt.
 * Truncates to maxChars.
 */
export function formatTranscript(
  turns: TranscriptTurn[],
  maxChars = 50_000
): string {
  const parts = turns.map((t) => `[${t.role}]: ${t.text}`);
  let text = parts.join("\n\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n\n[...truncated]";
  }
  return text;
}
