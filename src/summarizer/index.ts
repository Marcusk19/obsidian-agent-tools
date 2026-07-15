import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { createSessionPipeline } from "../core/session-pipeline.js";

const config = loadConfig();

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stderr.write(line);
  try {
    mkdirSync(config.dataDir, { recursive: true });
    appendFileSync(join(config.dataDir, "summarize.log"), line);
  } catch {
    // Logging is best effort.
  }
}

async function main(): Promise<void> {
  const tempFile = process.argv[2];
  if (!tempFile) {
    log("error: no temp file argument provided");
    process.exitCode = 1;
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(readFileSync(tempFile, "utf8"));
  } catch (error) {
    log(`error: failed to read session input: ${error}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await createSessionPipeline(config).process(input);
    if (result) log(`wrote to ${result.path}`);
    else log("skipping: session did not produce a summary");
  } catch (error) {
    log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
