import type { MemoryCandidate } from "./types.js";
export declare function renderMemoryContext(candidates: MemoryCandidate[], maxChars: number): {
    rendered: string;
    truncated: boolean;
};
