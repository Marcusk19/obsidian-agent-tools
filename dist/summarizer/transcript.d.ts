export interface TranscriptTurn {
    role: "user" | "assistant";
    text: string;
}
/**
 * Parse a Claude Code JSONL transcript file into conversation turns.
 *
 * Extracts user and assistant text content, skipping tool_use/tool_result/thinking blocks.
 * Returns null if the session is too short to be worth summarizing.
 */
export declare function parseTranscript(path: string): TranscriptTurn[] | null;
/**
 * Format transcript turns into a single string for the summarization prompt.
 * Truncates to maxChars.
 */
export declare function formatTranscript(turns: TranscriptTurn[], maxChars?: number): string;
