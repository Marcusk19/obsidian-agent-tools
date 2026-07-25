import { homedir } from "node:os";
import { join } from "node:path";
export function loadConfig(env = process.env) {
    const home = env.HOME || homedir() || "/tmp";
    const positiveNumber = (name, fallback) => {
        const value = Number(env[name]);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    const nonNegativeNumber = (name, fallback) => {
        const raw = env[name];
        if (raw === undefined || raw.trim() === "")
            return fallback;
        const value = Number(raw);
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    };
    return {
        vaultPath: env.OBSIDIAN_VAULT || join(home, "obsidian-git-sync"),
        dataDir: env.OBSIDIAN_DATA_DIR || join(home, ".local", "share", "obsidian-agent-tools"),
        ollamaHost: (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, ""),
        summaryModel: env.OBSIDIAN_SUMMARY_MODEL || "qwen2.5:7b",
        summaryMaxChars: positiveNumber("OBSIDIAN_SUMMARY_MAX_CHARS", 50_000),
        summaryMinTurns: positiveNumber("OBSIDIAN_SUMMARY_MIN_TURNS", 2),
        summaryMinChars: positiveNumber("OBSIDIAN_SUMMARY_MIN_CHARS", 200),
        memoryMaxChars: positiveNumber("OBSIDIAN_MEMORY_MAX_CHARS", 2_000),
        memoryMaxResults: nonNegativeNumber("OBSIDIAN_MEMORY_MAX_RESULTS", 1),
        memoryProjectResults: nonNegativeNumber("OBSIDIAN_MEMORY_PROJECT_RESULTS", 1),
        memoryBroadResults: nonNegativeNumber("OBSIDIAN_MEMORY_BROAD_RESULTS", 0),
    };
}
