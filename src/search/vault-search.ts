import type Database from "better-sqlite3";
import { join } from "node:path";
import { openVaultIndex, rebuildVaultIndex, type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { syncVaultIndex } from "./vault-indexer.js";
import {
  applyRetrievalPolicy,
  type MemoryScopeContext,
  type RetrievalCandidate,
  type VaultSearchResult,
} from "./retrieval-policy.js";

const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 100;

export type { MemoryScopeContext, VaultSearchResult } from "./retrieval-policy.js";

export interface VaultSearchOptions {
  query: string;
  vaultPath: string;
  dataDir: string;
  limit?: number;
  embed?: typeof defaultEmbed;
  db?: VaultIndexDatabase;
  rebuild?: boolean;
  pathPrefixes?: string[];
  statuses?: string[];
  memoryScope?: MemoryScopeContext;
  semantic?: boolean;
}

function termsFor(text: string): string[] {
  return text.match(/[\p{L}\p{N}_-]+/gu) || [];
}

function ftsQuery(text: string): string {
  const terms = termsFor(text);
  return terms.length ? terms.map((term) => `"${term.replaceAll('"', "")}"`).join(" OR ") : '""';
}

function buildPathFilter(pathPrefixes?: string[], column = "path"): { clause: string; params: string[] } {
  if (!pathPrefixes?.length) return { clause: "", params: [] };
  const safe = pathPrefixes.map((prefix) => `${prefix.replace(/([_%\\])/g, "\\$1")}%`);
  return {
    clause: ` AND (${safe.map(() => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
    params: safe,
  };
}

function bm25Strength(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return rank < 0 ? -rank : 1 / (1 + rank);
}

function vectorDistanceToScore(distance: number): number {
  return 1 / (1 + Math.max(0, distance));
}

function keywordCandidates(
  db: VaultIndexDatabase,
  query: string,
  pathPrefixes?: string[],
): RetrievalCandidate[] {
  const filter = buildPathFilter(pathPrefixes, "f.path");
  const rows = db.prepare(`
    SELECT f.chunk_id, f.path, f.title, f.heading, f.content,
           c.start_line, c.end_line, n.content AS note_content,
           bm25(vault_chunk_fts, 1.0, 2.0, 1.5) AS rank
    FROM vault_chunk_fts AS f
    JOIN vault_chunks AS c ON c.chunk_id = f.chunk_id
    JOIN vault_notes AS n ON n.path = f.path
    WHERE vault_chunk_fts MATCH ?${filter.clause}
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery(query), ...filter.params, CANDIDATE_LIMIT) as Array<{
    chunk_id: string;
    path: string;
    title: string;
    heading: string;
    content: string;
    start_line: number;
    end_line: number;
    note_content: string;
    rank: number;
  }>;
  const maxStrength = Math.max(...rows.map((row) => bm25Strength(row.rank)), 0);
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    path: row.path,
    title: row.title,
    heading: row.heading,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    noteContent: row.note_content,
    vectorScore: 0,
    textScore: maxStrength > 0 ? bm25Strength(row.rank) / maxStrength : 0,
    keywordConfirmed: true,
  }));
}

function vectorCandidates(
  db: VaultIndexDatabase,
  vector: number[],
  pathPrefixes?: string[],
): RetrievalCandidate[] {
  const matches = db.prepare(`
    SELECT chunk_id, distance
    FROM vault_chunk_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(JSON.stringify(vector), CANDIDATE_LIMIT) as Array<{ chunk_id: string; distance: number }>;
  if (matches.length === 0) return [];

  const byId = new Map(matches.map((match) => [match.chunk_id, match.distance]));
  const placeholders = matches.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT c.chunk_id, c.path, n.title, c.heading, c.start_line, c.end_line,
           c.content, n.content AS note_content
    FROM vault_chunks AS c
    JOIN vault_notes AS n ON n.path = c.path
    WHERE c.chunk_id IN (${placeholders})
  `).all(...matches.map((match) => match.chunk_id)) as Array<{
    chunk_id: string;
    path: string;
    title: string;
    heading: string;
    start_line: number;
    end_line: number;
    content: string;
    note_content: string;
  }>;

  return rows
    .filter((row) => !pathPrefixes?.length || pathPrefixes.some((prefix) => row.path.startsWith(prefix)))
    .map((row) => ({
      chunkId: row.chunk_id,
      path: row.path,
      title: row.title,
      heading: row.heading,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      noteContent: row.note_content,
      vectorScore: vectorDistanceToScore(byId.get(row.chunk_id) ?? Number.POSITIVE_INFINITY),
      textScore: 0,
      keywordConfirmed: false,
    }));
}

/**
 * Synchronizes the vault and applies retrieval policy before returning results.
 * The database option lets tests and internal callers reuse an already-synced index.
 */
export async function searchVault(options: VaultSearchOptions): Promise<VaultSearchResult[]> {
  const query = options.query.replace(/\s+/g, " ").trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(options.limit || DEFAULT_LIMIT, 50));

  if (options.rebuild) rebuildVaultIndex(options.dataDir);
  const db = options.db || openVaultIndex(options.dataDir);
  await syncVaultIndex({
    vaultPath: options.vaultPath,
    db,
    embed: options.embed,
    force: options.rebuild,
    keywordOnly: options.semantic === false,
  });

  const keyword = keywordCandidates(db, query, options.pathPrefixes);
  if (options.semantic === false) {
    return applyRetrievalPolicy([], keyword, query, options.statuses, options.memoryScope).slice(0, limit);
  }

  let queryVector: number[] | null = null;
  try {
    queryVector = await (options.embed || defaultEmbed)(query);
  } catch {
    queryVector = null;
  }
  const vector = queryVector ? vectorCandidates(db, queryVector, options.pathPrefixes) : [];
  return applyRetrievalPolicy(vector, keyword, query, options.statuses, options.memoryScope).slice(0, limit);
}

export function defaultDataDir(home = process.env.HOME || "/tmp"): string {
  return join(home, ".local", "share", "obsidian-agent-tools");
}

/**
 * Renders vault search results as the Markdown block shared by the CLI
 * command and the MCP tool.
 */
export function formatVaultResults(results: VaultSearchResult[]): string {
  if (results.length === 0) return "No matching notes found.";
  return results
    .map((result, index) =>
      [
        `**${index + 1}. ${result.title}** (${result.confidence})`,
        `Path: ${result.path}`,
        result.heading
          ? `Section: ${result.heading} (lines ${result.startLine}-${result.endLine})`
          : `Lines: ${result.startLine}-${result.endLine}`,
        result.excerpt,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
