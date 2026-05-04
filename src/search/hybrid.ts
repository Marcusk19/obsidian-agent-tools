import type Database from "better-sqlite3";
import { embed } from "./embed.js";
import { rewriteQuery } from "./rewrite.js";

const RRF_K = 60;
const SEARCH_TOP_K = 20;
const MIN_RRF_SCORE = 0.015;

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
 * Sanitize a query for FTS5 by quoting each word.
 */
function sanitizeFts5Query(text: string): string {
  const words = text.match(/\w+/g);
  if (!words || words.length === 0) return '""';
  return words.map((w) => `"${w}"`).join(" OR ");
}

/**
 * BM25 keyword search via FTS5.
 */
function searchBm25(
  db: Database.Database,
  queryText: string,
  limit = SEARCH_TOP_K
): Array<{ content: string; topic: string; sessionId: string; cwd: string; date: string; createdAt: string; score: number }> {
  const ftsQuery = sanitizeFts5Query(queryText);
  const rows = db
    .prepare(
      `SELECT content, topic, session_id, cwd, date, created_at, rank
       FROM summary_fts WHERE summary_fts MATCH ?
       ORDER BY rank LIMIT ?`
    )
    .all(ftsQuery, limit) as Array<{
    content: string;
    topic: string;
    session_id: string;
    cwd: string;
    date: string;
    created_at: string;
    rank: number;
  }>;

  return rows.map((r) => ({
    content: r.content,
    topic: r.topic,
    sessionId: r.session_id,
    cwd: r.cwd,
    date: r.date,
    createdAt: r.created_at,
    score: r.rank,
  }));
}

/**
 * Vector similarity search via sqlite-vec.
 * Returns null if Ollama is unavailable.
 */
async function searchVector(
  db: Database.Database,
  queryText: string,
  limit = SEARCH_TOP_K
): Promise<Array<{
  content: string;
  topic: string;
  sessionId: string;
  cwd: string;
  date: string;
  createdAt: string;
  score: number;
}> | null> {
  const queryVec = await embed(queryText);
  if (!queryVec) return null;

  const rows = db
    .prepare(
      `SELECT content, topic, session_id, cwd, date, created_at, distance
       FROM summary_vec WHERE embedding MATCH ?
       ORDER BY distance LIMIT ?`
    )
    .all(JSON.stringify(queryVec), limit) as Array<{
    content: string;
    topic: string;
    session_id: string;
    cwd: string;
    date: string;
    created_at: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    content: r.content,
    topic: r.topic,
    sessionId: r.session_id,
    cwd: r.cwd,
    date: r.date,
    createdAt: r.created_at,
    score: r.distance,
  }));
}

/**
 * Hybrid search: BM25 + vector, merged with Reciprocal Rank Fusion.
 */
export async function searchHybrid(
  db: Database.Database,
  query: string,
  limit = 10,
  days = 0
): Promise<SearchResult[]> {
  const rewritten = rewriteQuery(query);
  if (!rewritten) return [];

  const bm25Results = searchBm25(db, rewritten);
  const vecResults = await searchVector(db, rewritten);

  // RRF merge
  const rrfScores = new Map<string, number>();
  const docMap = new Map<
    string,
    { content: string; topic: string; sessionId: string; cwd: string; date: string; createdAt: string }
  >();

  // Key by content hash (simple approach: first 100 chars + date)
  const docKey = (doc: { content: string; date: string }) =>
    `${doc.date}:${doc.content.slice(0, 100)}`;

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const doc = bm25Results[rank];
    const key = docKey(doc);
    rrfScores.set(key, (rrfScores.get(key) || 0) + 1 / (RRF_K + rank + 1));
    docMap.set(key, doc);
  }

  if (vecResults) {
    for (let rank = 0; rank < vecResults.length; rank++) {
      const doc = vecResults[rank];
      const key = docKey(doc);
      rrfScores.set(key, (rrfScores.get(key) || 0) + 1 / (RRF_K + rank + 1));
      docMap.set(key, doc);
    }
  }

  // Sort by RRF score, filter, limit
  const sortedKeys = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score >= MIN_RRF_SCORE);

  // Optional date filter
  let cutoffDate = "";
  if (days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoffDate = cutoff.toISOString().split("T")[0];
  }

  const results: SearchResult[] = [];
  for (const [key, score] of sortedKeys) {
    if (results.length >= limit) break;
    const doc = docMap.get(key);
    if (!doc) continue;
    if (cutoffDate && doc.date < cutoffDate) continue;
    results.push({ ...doc, rrfScore: score });
  }

  return results;
}
