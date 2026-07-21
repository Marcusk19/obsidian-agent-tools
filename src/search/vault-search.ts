import type Database from "better-sqlite3";
import { join } from "node:path";
import { openVaultIndex, rebuildVaultIndex, type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { syncVaultIndex } from "./vault-indexer.js";

const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 30;

export interface VaultSearchOptions {
  query: string;
  vaultPath: string;
  dataDir: string;
  limit?: number;
  embed?: typeof defaultEmbed;
  db?: VaultIndexDatabase;
  rebuild?: boolean;
}

export interface VaultSearchResult {
  path: string;
  title: string;
  excerpt: string;
  semanticScore: number;
  keywordConfirmed: boolean;
  confidence: "confirmed" | "semantic";
}

function termsFor(text: string): string[] {
  return text.match(/\w+/g) || [];
}

function ftsQuery(text: string): string {
  const terms = termsFor(text);
  return terms.length ? terms.map((term) => `"${term}"`).join(" OR ") : '""';
}

function excerpt(content: string, query: string): string {
  const terms = termsFor(query);
  const lower = content.toLowerCase();
  const position = terms.reduce((found, term) => {
    const index = lower.indexOf(term.toLowerCase());
    return found === -1 ? index : found;
  }, -1);
  const start = Math.max(0, position === -1 ? 0 : position - 120);
  const end = Math.min(content.length, start + 360);
  return content.slice(start, end).trim();
}

interface Candidate {
  path: string;
  title: string;
  content: string;
  distance: number;
}

function semanticCandidates(db: VaultIndexDatabase, vector: number[]): Candidate[] {
  return db.prepare(`
    SELECT path, title, content, distance
    FROM vault_note_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(JSON.stringify(vector), CANDIDATE_LIMIT) as Candidate[];
}

function confirmedCandidates(db: VaultIndexDatabase, query: string, paths?: string[]): Map<string, { rank: number; content: string; title: string }> {
  const keyword = ftsQuery(query);
  if (paths && paths.length === 0) return new Map();
  const pathClause = paths ? ` AND path IN (${paths.map(() => "?").join(",")})` : "";
  const params = paths ? [keyword, ...paths] : [keyword];
  const rows = db.prepare(`
    SELECT path, title, content, rank
    FROM vault_note_fts
    WHERE vault_note_fts MATCH ?${pathClause}
    ORDER BY rank
    LIMIT ?
  `).all(...params, DEFAULT_LIMIT) as Array<{ path: string; title: string; content: string; rank: number }>;
  return new Map(rows.map((row) => [row.path, { rank: row.rank, content: row.content, title: row.title }]));
}

function broadKeywordResults(db: VaultIndexDatabase, query: string, limit: number): VaultSearchResult[] {
  const keyword = ftsQuery(query);
  const rows = db.prepare(`
    SELECT path, title, content, rank
    FROM vault_note_fts
    WHERE vault_note_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(keyword, limit) as Array<{ path: string; title: string; content: string; rank: number }>;
  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    excerpt: excerpt(row.content, query),
    semanticScore: 0,
    keywordConfirmed: true,
    confidence: "confirmed" as const,
  }));
}

export async function searchVault(options: VaultSearchOptions): Promise<VaultSearchResult[]> {
  const query = options.query.replace(/\s+/g, " ").trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(options.limit || DEFAULT_LIMIT, 50));

  if (options.rebuild) rebuildVaultIndex(options.dataDir);
  const db = options.db || openVaultIndex(options.dataDir);
  await syncVaultIndex({ vaultPath: options.vaultPath, db, embed: options.embed, force: options.rebuild });

  let vector: number[] | null = null;
  try {
    vector = await (options.embed || defaultEmbed)(query);
  } catch {
    vector = null;
  }

  if (!vector) return broadKeywordResults(db, query, limit);
  const candidates = semanticCandidates(db, vector);
  if (candidates.length === 0) return broadKeywordResults(db, query, limit);

  const confirmed = confirmedCandidates(db, query, candidates.map((candidate) => candidate.path));
  const results = candidates.map((candidate) => {
    const match = confirmed.get(candidate.path);
    return {
      path: candidate.path,
      title: candidate.title,
      excerpt: excerpt(match?.content || candidate.content, query),
      semanticScore: candidate.distance,
      keywordConfirmed: Boolean(match),
      confidence: match ? "confirmed" as const : "semantic" as const,
    };
  });

  return results
    .sort((a, b) => Number(b.keywordConfirmed) - Number(a.keywordConfirmed) || a.semanticScore - b.semanticScore)
    .slice(0, limit);
}

export function defaultDataDir(home = process.env.HOME || "/tmp"): string {
  return join(home, ".local", "share", "obsidian-agent-tools");
}
