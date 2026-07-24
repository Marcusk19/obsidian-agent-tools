import type Database from "better-sqlite3";
import { basename, extname, join } from "node:path";
import { openVaultIndex, rebuildVaultIndex, type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { syncVaultIndex } from "./vault-indexer.js";

const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 100;
const VECTOR_WEIGHT = 0.65;
const TEXT_WEIGHT = 0.35;
const PATH_BOOST_MAX = 0.15;

export interface MemoryScopeContext {
  repository?: string;
  project?: string;
  query?: string;
}

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

interface ChunkCandidate {
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

function termsFor(text: string): string[] {
  return text.match(/[\p{L}\p{N}_-]+/gu) || [];
}

function ftsQuery(text: string): string {
  const terms = termsFor(text);
  return terms.length ? terms.map((term) => `"${term.replaceAll('"', '')}"`).join(" OR ") : '""';
}

function section(content: string, heading: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return undefined;
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    collected.push(line);
  }
  return collected.join("\n").trim() || undefined;
}

function compact(content: string, maxChars: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function excerpt(candidate: ChunkCandidate, query: string): string {
  const rule = section(candidate.noteContent, "Rule");
  if (rule) {
    const appliesWhen = section(candidate.noteContent, "Applies when");
    return [compact(rule, 360), appliesWhen ? `Applies when: ${compact(appliesWhen, 140)}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  const terms = termsFor(query);
  const lower = candidate.content.toLowerCase();
  const positions = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((position) => position >= 0);
  const position = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, position - 120);
  const end = Math.min(candidate.content.length, start + 400);
  return compact(candidate.content.slice(start, end), 400);
}

function frontmatter(content: string): string | undefined {
  return content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
}

function matchesStatus(content: string, statuses?: string[]): boolean {
  if (!statuses?.length) return true;
  const metadata = frontmatter(content);
  if (!metadata) return false;
  const statusMatch = metadata.match(/^status:\s*(.+)$/m);
  if (!statusMatch) return false;
  const value = statusMatch[1].trim().toLowerCase();
  return statuses.some((status) => status.toLowerCase() === value);
}

function normalizeScope(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesMemoryScope(content: string, context?: MemoryScopeContext): boolean {
  if (!context) return true;
  const metadata = frontmatter(content);
  if (!metadata) return false;
  const lines = metadata.split(/\r?\n/);
  const scopeStart = lines.findIndex((line) => /^scope:\s*/.test(line));
  if (scopeStart === -1) return false;
  const rawScopeLines = [lines[scopeStart].replace(/^scope:\s*/, "")];
  for (const line of lines.slice(scopeStart + 1)) {
    if (/^[a-zA-Z_-]+:\s*/.test(line)) break;
    rawScopeLines.push(line);
  }
  const rawScopes = rawScopeLines.join("\n");
  if (/\bglobal\b/i.test(rawScopes)) return true;

  const repository = normalizeScope(context.repository || "");
  const project = normalizeScope(context.project || "");
  const queryTerms = new Set(termsFor(context.query || "").map(normalizeScope).filter((term) => term.length > 2));

  for (const match of rawScopes.matchAll(/(?:^|\n)\s*-?\s*(repository|project|tool|topic)\s*:\s*([^\n]+)/gi)) {
    const kind = match[1].toLowerCase();
    const value = normalizeScope(match[2]);
    if (kind === "repository" && repository && (value === repository || value.endsWith(` ${repository}`))) return true;
    if (kind === "project" && project && value === project) return true;
    if ((kind === "tool" || kind === "topic") && value.split(" ").some((term) => queryTerms.has(term))) return true;
  }
  return false;
}

function matchesFilters(content: string, statuses?: string[], memoryScope?: MemoryScopeContext): boolean {
  return matchesStatus(content, statuses) && matchesMemoryScope(content, memoryScope);
}

function escapeLikeFragment(prefix: string): string {
  return prefix.replace(/([_%\\])/g, "\\$1");
}

function buildPathFilter(pathPrefixes?: string[], column = "path"): { clause: string; params: string[] } {
  if (!pathPrefixes?.length) return { clause: "", params: [] };
  const safe = pathPrefixes.map((prefix) => `${escapeLikeFragment(prefix)}%`);
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
): ChunkCandidate[] {
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
): ChunkCandidate[] {
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

function pathBoost(candidate: ChunkCandidate, query: string): number {
  const normalizedQuery = normalizeScope(query);
  if (!normalizedQuery) return 0;
  const values = [
    candidate.path,
    basename(candidate.path),
    basename(candidate.path, extname(candidate.path)),
    candidate.title,
    candidate.heading,
  ].map(normalizeScope).filter(Boolean);
  if (values.some((value) => value === normalizedQuery)) return PATH_BOOST_MAX;
  const queryTerms = termsFor(normalizedQuery);
  if (queryTerms.length > 0 && values.some((value) => queryTerms.every((term) => value.includes(normalizeScope(term))))) {
    return PATH_BOOST_MAX / 2;
  }
  return 0;
}

function mergeCandidates(
  vector: ChunkCandidate[],
  keyword: ChunkCandidate[],
  query: string,
  statuses?: string[],
  memoryScope?: MemoryScopeContext,
): VaultSearchResult[] {
  const merged = new Map<string, ChunkCandidate>();
  for (const candidate of [...vector, ...keyword]) {
    const existing = merged.get(candidate.chunkId);
    if (!existing) {
      merged.set(candidate.chunkId, { ...candidate });
      continue;
    }
    existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
    existing.textScore = Math.max(existing.textScore, candidate.textScore);
    existing.keywordConfirmed ||= candidate.keywordConfirmed;
  }

  const bestByPath = new Map<string, { candidate: ChunkCandidate; score: number }>();
  for (const candidate of merged.values()) {
    if (!matchesFilters(candidate.noteContent, statuses, memoryScope)) continue;
    const score = VECTOR_WEIGHT * candidate.vectorScore + TEXT_WEIGHT * candidate.textScore + pathBoost(candidate, query);
    const existing = bestByPath.get(candidate.path);
    if (!existing || score > existing.score) bestByPath.set(candidate.path, { candidate, score });
  }

  return [...bestByPath.values()]
    .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path))
    .map(({ candidate, score }) => ({
      path: candidate.path,
      title: candidate.title,
      heading: candidate.heading,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      excerpt: excerpt(candidate, query),
      score,
      semanticScore: candidate.vectorScore,
      lexicalScore: candidate.textScore,
      keywordConfirmed: candidate.keywordConfirmed,
      confidence: candidate.keywordConfirmed ? "confirmed" as const : "semantic" as const,
    }));
}

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
    return mergeCandidates([], keyword, query, options.statuses, options.memoryScope).slice(0, limit);
  }

  let queryVector: number[] | null = null;
  try {
    queryVector = await (options.embed || defaultEmbed)(query);
  } catch {
    queryVector = null;
  }
  const vector = queryVector ? vectorCandidates(db, queryVector, options.pathPrefixes) : [];
  return mergeCandidates(vector, keyword, query, options.statuses, options.memoryScope).slice(0, limit);
}

export function defaultDataDir(home = process.env.HOME || "/tmp"): string {
  return join(home, ".local", "share", "obsidian-agent-tools");
}
