import type { AgentConfig } from "./config.js";
import { createOllamaClient, type OllamaClient } from "./ollama.js";
import { formatTranscript, validateNormalizedSession, type NormalizedSession } from "./session-format.js";
import { createSessionWriter, type SessionWriter } from "./session-writer.js";

export interface SessionPipeline {
  process(input: unknown): Promise<{ path: string } | null>;
}

export function createSessionPipeline(
  config: AgentConfig,
  dependencies: {
    ollama?: OllamaClient;
    writer?: SessionWriter;
  } = {},
): SessionPipeline {
  const ollama = dependencies.ollama || createOllamaClient(config);
  const writer = dependencies.writer || createSessionWriter(config);

  return {
    async process(input: unknown): Promise<{ path: string } | null> {
      const session: NormalizedSession = validateNormalizedSession(input);
      const transcript = formatTranscript(session.transcript, config);
      if (!transcript) return null;
      await ollama.ensureModel();
      const result = await ollama.summarize(transcript);
      if (!result) return null;
      const path = await writer.append(session, result);
      return { path };
    },
  };
}
