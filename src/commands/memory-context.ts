import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config.js";
import { retrieveMemoryContext } from "../memory/retrieve.js";
import type { MemoryRetrievalRequest } from "../memory/types.js";

export interface MemoryContextArgs {
  prompt: string;
  cwd?: string;
  repository?: string;
  project?: string;
}

export function parseArgs(argv: string[]): MemoryContextArgs {
  const options: Omit<MemoryContextArgs, "prompt"> = {};
  const promptParts: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd" || arg === "--repository" || arg === "--project") {
      const value = argv[++index];
      if (!value) throw new Error("Usage: obsidian-agent-context [--cwd PATH] [--repository NAME] [--project NAME] <prompt>");
      if (arg === "--cwd") options.cwd = value;
      else if (arg === "--repository") options.repository = value;
      else options.project = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      promptParts.push(arg);
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) throw new Error("Usage: obsidian-agent-context [--cwd PATH] [--repository NAME] [--project NAME] <prompt>");
  return { ...options, prompt };
}

interface CommandDependencies {
  retrieve: typeof retrieveMemoryContext;
  loadConfig: typeof loadConfig;
  stdout: Pick<typeof process.stdout, "write">;
}

const defaultDependencies: CommandDependencies = {
  retrieve: retrieveMemoryContext,
  loadConfig,
  stdout: process.stdout,
};

export async function run(argv: string[], partialDeps: Partial<CommandDependencies> = {}): Promise<void> {
  if (process.env.OBSIDIAN_MEMORY_ENABLED === "0") return;
  const args = parseArgs(argv);
  const { retrieve, loadConfig: load, stdout } = { ...defaultDependencies, ...partialDeps };

  let context;
  try {
    const config = load();
    const request: MemoryRetrievalRequest = {
      prompt: args.prompt,
      cwd: args.cwd,
      repository: args.repository,
      project: args.project,
      maxChars: config.memoryMaxChars,
    };
    context = await retrieve(request, config);
  } catch (error) {
    console.warn(`memory context unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const output = context.rendered.trim();
  if (!output) return;
  stdout.write(`${output}\n`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
