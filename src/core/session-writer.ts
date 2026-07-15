import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./config.js";
import { renderSessionEntry, type NormalizedSession, type SummaryResult } from "./session-format.js";

export interface SessionWriter {
  append(session: NormalizedSession, result: SummaryResult, now?: Date): Promise<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(path, "wx");
      closeSync(fd);
      return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`timed out acquiring session log lock: ${path}`);
}

export function createSessionWriter(config: AgentConfig): SessionWriter {
  return {
    async append(session, result, now = new Date()): Promise<string> {
      const date = now.toISOString().slice(0, 10);
      const time = now.toTimeString().slice(0, 5);
      const directory = join(config.vaultPath, "4_Archive", "_agent_sessions");
      const filePath = join(directory, `${date}.md`);
      const lockPath = `${filePath}.lock`;
      mkdirSync(directory, { recursive: true });
      await acquireLock(lockPath);
      try {
        const entry = renderSessionEntry(session, result, time);
        if (!existsSync(filePath)) {
          writeFileSync(filePath, `# Agent Sessions — ${date}\n\n${entry}`);
        } else {
          const content = readFileSync(filePath, "utf8");
          writeFileSync(filePath, `${content.trimEnd()}\n\n---\n\n${entry}`);
        }
        return filePath;
      } finally {
        try { unlinkSync(lockPath); } catch { /* best effort */ }
      }
    },
  };
}
