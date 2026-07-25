import type { AgentConfig } from "./config.js";
import { type OllamaClient } from "./ollama.js";
import { type SessionWriter } from "./session-writer.js";
export interface SessionPipeline {
    process(input: unknown): Promise<{
        path: string;
    } | null>;
}
export declare function createSessionPipeline(config: AgentConfig, dependencies?: {
    ollama?: OllamaClient;
    writer?: SessionWriter;
}): SessionPipeline;
