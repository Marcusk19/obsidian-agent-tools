import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseTranscript, formatTranscript } from "./transcript.js";
import { summarizeTranscript } from "./vertex.js";
import { appendSummary } from "./daily-note.js";
import { getDb, indexSummary } from "../db/index.js";
import { embed } from "../search/embed.js";

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

const DATA_DIR =
  process.env.CLAUDE_OBSIDIAN_DATA_DIR ||
  join(process.env.HOME || "/tmp", ".local", "share", "claude-obsidian");

function log(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  process.stderr.write(line);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, "summarize.log"), line);
  } catch {
    // Best effort
  }
}

async function main(): Promise<void> {
  const tempFile = process.argv[2];
  if (!tempFile) {
    log("error: no temp file argument provided");
    process.exit(1);
  }

  let input: HookInput;
  try {
    input = JSON.parse(readFileSync(tempFile, "utf-8"));
  } catch (err) {
    log(`error: failed to read hook input: ${err}`);
    process.exit(1);
  }

  const { session_id, transcript_path, cwd } = input;

  if (!transcript_path) {
    log("skipping: no transcript_path");
    return;
  }

  log(`processing session ${session_id} (cwd: ${cwd})`);

  // 1. Parse transcript
  const turns = parseTranscript(transcript_path);
  if (!turns) {
    log("skipping: session too short");
    return;
  }
  log(`parsed ${turns.length} turns`);

  // 2. Summarize via Vertex AI
  const formatted = formatTranscript(turns);
  const result = await summarizeTranscript(formatted);
  if (!result) {
    log("error: summarization returned no result");
    return;
  }
  log(`summary: "${result.topic}"`);

  // 3. Write to daily note
  const notePath = appendSummary(result.topic, result.summary, cwd);
  log(`wrote to ${notePath}`);

  // 4. Index into SQLite
  const id = randomUUID();
  const date = new Date().toISOString().split("T")[0];

  // Embed for vector search (best-effort)
  const embedding = await embed(`${result.topic}\n${result.summary}`);
  if (embedding) {
    log(`embedded (${embedding.length} dims)`);
  } else {
    log("vector indexing skipped (Ollama unavailable)");
  }

  try {
    indexSummary(id, session_id, date, cwd, result.topic, result.summary, embedding);
    log("indexed in SQLite");
  } catch (err) {
    log(`error: indexing failed: ${err}`);
  }

  log("done");
}

main().catch((err) => {
  log(`fatal: ${err}`);
  process.exit(1);
});
