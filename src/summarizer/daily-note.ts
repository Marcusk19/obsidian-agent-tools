import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";

const VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH || "/Users/mkok/obsidian-git-sync";
const DAILY_NOTES_DIR = join(VAULT_PATH, "4_Archive", "_daily_notes");
const DATA_DIR =
  process.env.CLAUDE_OBSIDIAN_DATA_DIR ||
  join(process.env.HOME || "/tmp", ".local", "share", "claude-obsidian");

const NOTE_TEMPLATE = `---
tags:
  - daily_note
---
## TODO
- [ ]
## Notes

## Log

## Claude Summaries
`;

const SUMMARIES_HEADER = "## Claude Summaries";

function getDateStr(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

function getTimeStr(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 5); // HH:MM
}

function shortenCwd(cwd: string): string {
  const home = process.env.HOME || "";
  if (home && cwd.startsWith(home)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

/**
 * Simple directory-based lock. mkdirSync with { recursive: false } is atomic
 * on POSIX — it fails if the directory already exists.
 */
function acquireLock(maxWaitMs = 10_000): string {
  const lockPath = join(DATA_DIR, "write.lock");
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath, { recursive: false });
      return lockPath;
    } catch {
      // Lock held by another process, wait and retry
      const waitMs = 50 + Math.random() * 100;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        // busy wait (sync context, no setTimeout available)
      }
    }
  }

  // Force-break stale lock after timeout
  try {
    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath, { recursive: false });
    return lockPath;
  } catch {
    throw new Error("Failed to acquire write lock");
  }
}

function releaseLock(lockPath: string): void {
  try {
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/**
 * Append a session summary to today's daily note under ## Claude Summaries.
 *
 * Creates the note from template if it doesn't exist.
 * Uses a directory-based lock for concurrent write safety.
 */
export function appendSummary(
  topic: string,
  summary: string,
  cwd: string
): string {
  const date = getDateStr();
  const time = getTimeStr();
  const notePath = join(DAILY_NOTES_DIR, `${date}.md`);

  // Ensure directories exist
  mkdirSync(dirname(notePath), { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const entry = `### ${time} — ${topic}\n${summary}\n*CWD: ${shortenCwd(cwd)}*\n`;

  const lockPath = acquireLock();
  try {
    if (!existsSync(notePath)) {
      writeFileSync(notePath, NOTE_TEMPLATE + "\n" + entry);
    } else {
      let content = readFileSync(notePath, "utf-8");

      if (!content.includes(SUMMARIES_HEADER)) {
        content =
          content.trimEnd() + "\n\n" + SUMMARIES_HEADER + "\n\n" + entry;
      } else {
        content = content.trimEnd() + "\n\n" + entry;
      }

      writeFileSync(notePath, content);
    }
  } finally {
    releaseLock(lockPath);
  }

  return notePath;
}
