import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentConfig {
  vaultPath: string;
  dataDir: string;
  ollamaHost: string;
  summaryModel: string;
  summaryMaxChars: number;
  summaryMinTurns: number;
  summaryMinChars: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const home = env.HOME || homedir() || "/tmp";
  const number = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    vaultPath: env.OBSIDIAN_VAULT || join(home, "obsidian-git-sync"),
    dataDir: env.OBSIDIAN_DATA_DIR || join(home, ".local", "share", "obsidian-agent-tools"),
    ollamaHost: (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, ""),
    summaryModel: env.OBSIDIAN_SUMMARY_MODEL || "qwen2.5:7b",
    summaryMaxChars: number("OBSIDIAN_SUMMARY_MAX_CHARS", 50_000),
    summaryMinTurns: number("OBSIDIAN_SUMMARY_MIN_TURNS", 2),
    summaryMinChars: number("OBSIDIAN_SUMMARY_MIN_CHARS", 200),
  };
}
