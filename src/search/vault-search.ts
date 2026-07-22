import type Database from "better-sqlite3";
import { join } from "node:path";
import { openVaultIndex, rebuildVaultIndex, type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { syncVaultIndex } from "./vault-indexer.js";

const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 30;

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
  const rule = section(content, "Rule");
  if (rule) {
    const appliesWhen = section(content, "Applies when");
    return [compact(rule, 360), appliesWhen ? `Applies when: ${compact(appliesWhen, 140)}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*/, "");
  const terms = termsFor(query);
  const lower = body.toLowerCase();
  const position = terms.reduce((found, term) => {
    const index = lower.indexOf(term.toLowerCase());
    return found === -1 ? index : found;
  }, -1);
  const start = Math.max(0, position === -1 ? 0 : position - 120);
  const end = Math.min(body.length, start + 400);
  return compact(body.slice(start, end), 400);
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

interface Candidate {
  path: string;
  title: string;
  content: string;
  distance: number;
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

function buildPathFilter(pathPrefixes?: string[]): { clause: string; params: string[] } {
  if (!pathPrefixes?.length) {
    return { clause: "", params: [] };
  }
  const safe = pathPrefixes.map((prefix) => `${escapeLikeFragment(prefix)}%`);
  return {
    clause: ` AND (${safe.map(() => "path LIKE ? ESCAPE '\\'").join(" OR ")})`,
    params: safe,
  };
}

function semanticCandidates(db: VaultIndexDatabase, vector: number[], pathPrefixes?: string[]): Candidate[] {
  const rows = db.prepare(`
    SELECT path, title, content, distance
    FROM vault_note_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(JSON.stringify(vector), CANDIDATE_LIMIT) as Candidate[];
  if (!pathPrefixes?.length) return rows;
  return rows.filter((row) => pathPrefixes.some((prefix) => row.path.startsWith(prefix)));
}

function confirmedCandidates(db: VaultIndexDatabase, query: string, paths?: string[], pathPrefixes?: string[]): Map<string, { rank: number; content: string; title: string }> {
  const keyword = ftsQuery(query);
  if (paths && paths.length === 0) return new Map();
  let clause = "";
  const params: Array<string | number> = [keyword];
  if (paths && paths.length > 0) {
    clause += ` AND path IN (${paths.map(() => "?").join(",")})`;
    params.push(...paths);
  }
  const filter = buildPathFilter(pathPrefixes);
  clause += filter.clause;
  params.push(...filter.params);
  const rows = db.prepare(`
    SELECT path, title, content, rank
    FROM vault_note_fts
    WHERE vault_note_fts MATCH ?${clause}
    ORDER BY rank
    LIMIT ?
  `).all(...params, DEFAULT_LIMIT) as Array<{ path: string; title: string; content: string; rank: number }>;
  return new Map(rows.map((row) => [row.path, { rank: row.rank, content: row.content, title: row.title }]));
}

function broadKeywordResults(
  db: VaultIndexDatabase,
  query: string,
  limit: number,
  pathPrefixes?: string[],
  statuses?: string[],
  memoryScope?: MemoryScopeContext,
): VaultSearchResult[] {
  const keyword = ftsQuery(query);
  const { clause, params } = buildPathFilter(pathPrefixes);
  const rows = db.prepare(`
    SELECT path, title, content, rank
    FROM vault_note_fts
    WHERE vault_note_fts MATCH ?${clause}
    ORDER BY rank
    LIMIT ?
  `).all(keyword, ...params, limit) as Array<{ path: string; title: string; content: string; rank: number }>;
  return rows
    .filter((row) => matchesFilters(row.content, statuses, memoryScope))
    .map((row) => ({
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
  await syncVaultIndex({
    vaultPath: options.vaultPath,
    db,
    embed: options.embed,
    force: options.rebuild,
    keywordOnly: options.semantic === false,
  });

  if (options.semantic === false) {
    return broadKeywordResults(db, query, limit, options.pathPrefixes, options.statuses, options.memoryScope);
  }

  let vector: number[] | null = null;
  try {
    vector = await (options.embed || defaultEmbed)(query);
  } catch {
    vector = null;
  }

  if (!vector) return broadKeywordResults(db, query, limit, options.pathPrefixes, options.statuses, options.memoryScope);
  const candidates = semanticCandidates(db, vector, options.pathPrefixes);
  if (candidates.length === 0) return broadKeywordResults(db, query, limit, options.pathPrefixes, options.statuses, options.memoryScope);

  const confirmed = confirmedCandidates(db, query, candidates.map((candidate) => candidate.path), options.pathPrefixes);
  const results = candidates.reduce<VaultSearchResult[]>((acc, candidate) => {
    const match = confirmed.get(candidate.path);
    const content = match?.content || candidate.content;
    if (!matchesFilters(content, options.statuses, options.memoryScope)) return acc;
    acc.push({
      path: candidate.path,
      title: candidate.title,
      excerpt: excerpt(content, query),
      semanticScore: match?.rank ?? candidate.distance,
      keywordConfirmed: Boolean(match),
      confidence: match ? "confirmed" as const : "semantic" as const,
    });
    return acc;
  }, []);

  return results
    .sort((a, b) => Number(b.keywordConfirmed) - Number(a.keywordConfirmed) || a.semanticScore - b.semanticScore)
    .slice(0, limit);
}

export function defaultDataDir(home = process.env.HOME || "/tmp"): string {
  return join(home, ".local", "share", "obsidian-agent-tools");
}
