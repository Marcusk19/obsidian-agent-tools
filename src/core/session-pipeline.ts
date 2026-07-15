import { randomUUID } from "node:crypto";
import type { AgentConfig } from "./config.js";
import { createOllamaClient, type OllamaClient } from "./ollama.js";
import { formatTranscript, validateNormalizedSession, type NormalizedSession } from "./session-format.js";
import { createSessionWriter, type SessionWriter } from "./session-writer.js";
import { embed as defaultEmbed } from "../search/embed.js";
import { indexSummary as defaultIndexSummary } from "../db/index.js";

export interface SessionPipeline {
  process(input: unknown): Promise<{ path: string } | null>;
}

export function createSessionPipeline(
  config: AgentConfig,
  dependencies: {
    ollama?: OllamaClient;
    writer?: SessionWriter;
    embed?: typeof defaultEmbed;
    index?: typeof defaultIndexSummary;
  } = {},
): SessionPipeline {
  const ollama = dependencies.ollama || createOllamaClient(config);
  const writer = dependencies.writer || createSessionWriter(config);
  const makeEmbedding = dependencies.embed || defaultEmbed;
  const index = dependencies.index || defaultIndexSummary;

  return {
    async process(input: unknown): Promise<{ path: string } | null> {
      const session: NormalizedSession = validateNormalizedSession(input);
      const transcript = formatTranscript(session.transcript, config);
      if (!transcript) return null;
      await ollama.ensureModel();
      const result = await ollama.summarize(transcript);
      if (!result) return null;
      const path = await writer.append(session, result);
      let embedding: number[] | null = null;
      try {
        embedding = await makeEmbedding(`${result.topic}\n${result.summary}`);
      } catch (error) {
        console.error(`embedding failed: ${error}`);
      }
      try {
        index(randomUUID(), session.sessionId, new Date().toISOString().slice(0, 10), session.cwd, result.topic, result.summary, embedding);
      } catch (error) {
        console.error(`indexing failed: ${error}`);
      }
      return { path };
    },
  };
}
