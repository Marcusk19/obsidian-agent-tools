import type { AgentConfig } from "./config.js";
export interface NormalizedSession {
    runtime: "claude-code" | "pi";
    sessionId: string;
    transcript: string;
    cwd: string;
    startedAt?: string;
    endedAt?: string;
}
export interface SummaryResult {
    topic: string;
    summary: string;
}
export declare function validateNormalizedSession(value: unknown): NormalizedSession;
export declare function formatTranscript(transcript: string, config: Pick<AgentConfig, "summaryMaxChars" | "summaryMinTurns" | "summaryMinChars">): string | null;
export declare function shortenCwd(cwd: string, home?: string): string;
export declare function parseSummaryResponse(text: string): SummaryResult | null;
export declare function renderSessionEntry(session: NormalizedSession, result: SummaryResult, time: string): string;
