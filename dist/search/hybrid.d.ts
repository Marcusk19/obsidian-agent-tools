import type Database from "better-sqlite3";
export interface SearchResult {
    topic: string;
    content: string;
    sessionId: string;
    cwd: string;
    date: string;
    createdAt: string;
    rrfScore: number;
}
/**
 * Hybrid search: BM25 + vector, merged with Reciprocal Rank Fusion.
 */
export declare function searchHybrid(db: Database.Database, query: string, limit?: number, days?: number): Promise<SearchResult[]>;
