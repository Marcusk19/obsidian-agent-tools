import Database from "better-sqlite3";
/**
 * Get or create the SQLite database connection.
 * Loads sqlite-vec extension and runs migrations on first call.
 */
export declare function getDb(): Database.Database;
/**
 * Insert a summary into all indexes (summaries table, FTS5, optionally vec).
 */
export declare function indexSummary(id: string, sessionId: string, date: string, cwd: string, topic: string, content: string, embedding: number[] | null): void;
