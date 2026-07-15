import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentConfig } from "./config.js";
import { parseSummaryResponse, type SummaryResult } from "./session-format.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;

export interface OllamaClient {
  ensureModel(): Promise<void>;
  summarize(transcript: string): Promise<SummaryResult | null>;
}

const PROMPT = `You are a session summarizer. Summarize this coding session as a brief handoff note.

Return exactly:
<topic>
A descriptive topic under 60 characters.
</topic>

<summary>
A single paragraph of 3-6 plain prose sentences describing accomplishments, key decisions, current status, and next steps when supported by the transcript.
</summary>

Write the topic and summary entirely in English. Do not use Chinese or any other language. Do not use bullets, bold text, headers, code blocks, or speculation. Only include facts explicitly supported by the transcript.

Transcript:
`;

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaClient(config: AgentConfig): OllamaClient {
  return {
    async ensureModel(): Promise<void> {
      const response = await request(`${config.ollamaHost}/api/tags`, {});
      if (!response.ok) throw new Error(`Ollama unavailable at ${config.ollamaHost}`);
      const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const found = (data.models || []).some((model) =>
        [model.name, model.model].some((name) => name === config.summaryModel || name?.split(":")[0] === config.summaryModel.split(":")[0]),
      );
      if (found) return;
      await execFileAsync("ollama", ["pull", config.summaryModel], { timeout: 10 * 60 * 1000 });
    },

    async summarize(transcript: string): Promise<SummaryResult | null> {
      const response = await request(`${config.ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.summaryModel,
          stream: false,
          messages: [{ role: "user", content: PROMPT + transcript }],
        }),
      });
      if (!response.ok) throw new Error(`Ollama chat failed with HTTP ${response.status}`);
      const data = (await response.json()) as { message?: { content?: string } };
      return parseSummaryResponse(data.message?.content || "");
    },
  };
}
