import type { AgentConfig } from "./config.js";
import { type SummaryResult } from "./session-format.js";
export interface OllamaClient {
    ensureModel(): Promise<void>;
    summarize(transcript: string): Promise<SummaryResult | null>;
}
export declare function createOllamaClient(config: AgentConfig): OllamaClient;
