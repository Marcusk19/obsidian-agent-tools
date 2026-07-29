export interface MemoryScopeContext {
    repository?: string;
    project?: string;
    query?: string;
}
export interface VaultSearchResult {
    path: string;
    title: string;
    heading: string;
    startLine: number;
    endLine: number;
    excerpt: string;
    score: number;
    semanticScore: number;
    lexicalScore: number;
    keywordConfirmed: boolean;
    confidence: "confirmed" | "semantic";
}
export interface RetrievalCandidate {
    chunkId: string;
    path: string;
    title: string;
    heading: string;
    startLine: number;
    endLine: number;
    content: string;
    noteContent: string;
    vectorScore: number;
    textScore: number;
    keywordConfirmed: boolean;
}
/**
 * Applies retrieval policy in one place: eligibility, score merging, path
 * boosts, per-note deduplication, and excerpt/provenance shaping.
 */
export declare function applyRetrievalPolicy(vector: RetrievalCandidate[], keyword: RetrievalCandidate[], query: string, statuses?: string[], memoryScope?: MemoryScopeContext): VaultSearchResult[];
