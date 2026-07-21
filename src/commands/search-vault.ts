import { join } from "node:path";
import { searchVault } from "../search/vault-search.js";

export interface SearchVaultArgs {
  command: "vault";
  query: string;
  limit: number;
  rebuild: boolean;
}

export function parseArgs(args: string[]): SearchVaultArgs {
  if (args[0] !== "vault") throw new Error("Usage: obsidian-agent-search vault [--limit N] [--rebuild] <query>");
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
  if (!query) throw new Error("Usage: obsidian-agent-search vault [--limit N] [--rebuild] <query>");
  return { command: "vault", query, limit, rebuild };
}

function configuredVault(): string {
  return process.env.OBSIDIAN_VAULT || join(process.env.HOME || "/tmp", "obsidian-git-sync");
}

function configuredDataDir(): string {
  return process.env.OBSIDIAN_DATA_DIR || join(process.env.HOME || "/tmp", ".local", "share", "obsidian-agent-tools");
}

export async function run(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const results = await searchVault({
    query: parsed.query,
    limit: parsed.limit,
    rebuild: parsed.rebuild,
    vaultPath: configuredVault(),
    dataDir: configuredDataDir(),
  });
  if (results.length === 0) {
    process.stdout.write("No matching notes found.\n");
    return;
  }
  process.stdout.write(results.map((result, index) => [
    `**${index + 1}. ${result.title}** (${result.confidence})`,
    `Path: ${result.path}`,
    result.excerpt,
  ].join("\n")).join("\n\n---\n\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
