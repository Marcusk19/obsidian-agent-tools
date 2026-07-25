import type { AgentConfig } from "./config.js";
import { type NormalizedSession, type SummaryResult } from "./session-format.js";
export interface SessionWriter {
    append(session: NormalizedSession, result: SummaryResult, now?: Date): Promise<string>;
}
export declare function createSessionWriter(config: AgentConfig): SessionWriter;
