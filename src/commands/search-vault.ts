import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { closeVaultIndex, openVaultIndex, readVaultIndexStatus } from "../db/vault-index.js";
import { formatVaultResults, searchVault } from "../search/vault-search.js";

export interface SearchVaultArgs {
  command: "vault" | "status";
  query: string;
  limit: number;
  rebuild: boolean;
}

export function parseArgs(args: string[]): SearchVaultArgs {
  if (args[0] !== "vault" && args[0] !== "status") throw new Error("Usage: obsidian-agent-search vault [--limit N] [--rebuild] <query> | status");
  const command = args[0] as "vault" | "status";
  let limit = 10;
  let rebuild = false;
  const queryParts: string[] = [];

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--rebuild") {
      rebuild = true;
    } else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("--limit must be an integer from 1 to 50");
      limit = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      queryParts.push(arg);
    }
  }

  const query = queryParts.join(" ").trim();
  if (command === "vault" && !query) throw new Error("Usage: obsidian-agent-search vault [--limit N] [--rebuild] <query>");
  if (command === "status" && query) throw new Error("Usage: obsidian-agent-search status");
  return { command, query, limit, rebuild };
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const config = loadConfig();
  if (parsed.command === "status") {
    const db = openVaultIndex(config.dataDir);
    try {
      const status = readVaultIndexStatus(db);
      process.stdout.write(JSON.stringify({
        ...status,
        vaultPath: config.vaultPath,
        dataDir: config.dataDir,
      }, null, 2) + "\n");
    } finally {
      closeVaultIndex(db);
    }
    return;
  }
  const results = await searchVault({
    query: parsed.query,
    limit: parsed.limit,
    rebuild: parsed.rebuild,
    vaultPath: config.vaultPath,
    dataDir: config.dataDir,
  });
  process.stdout.write(formatVaultResults(results) + "\n");
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
