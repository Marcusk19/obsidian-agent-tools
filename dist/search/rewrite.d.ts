/**
 * Query preprocessing for search — ported from takopod/worker/search.py.
 *
 * Strips greetings, hedging phrases, and stop words while preserving
 * quoted strings and technical terms.
 */
/**
 * Transform a user message into a search-optimized query.
 *
 * Returns null if the query is too short to search.
 */
export declare function rewriteQuery(message: string): string | null;
