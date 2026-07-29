import { join } from "node:path";
import { openVaultIndex, rebuildVaultIndex } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { syncVaultIndex } from "./vault-indexer.js";
import { applyRetrievalPolicy, } from "./retrieval-policy.js";
const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 100;
function termsFor(text) {
    return text.match(/[\p{L}\p{N}_-]+/gu) || [];
}
function ftsQuery(text) {
    const terms = termsFor(text);
    return terms.length ? terms.map((term) => `"${term.replaceAll('"', "")}"`).join(" OR ") : '""';
}
function buildPathFilter(pathPrefixes, column = "path") {
    if (!pathPrefixes?.length)
        return { clause: "", params: [] };
    const safe = pathPrefixes.map((prefix) => `${prefix.replace(/([_%\\])/g, "\\$1")}%`);
    return {
        clause: ` AND (${safe.map(() => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
        params: safe,
    };
}
function bm25Strength(rank) {
    if (!Number.isFinite(rank))
        return 0;
    return rank < 0 ? -rank : 1 / (1 + rank);
}
function vectorDistanceToScore(distance) {
    return 1 / (1 + Math.max(0, distance));
}
function keywordCandidates(db, query, pathPrefixes) {
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
  `).all(ftsQuery(query), ...filter.params, CANDIDATE_LIMIT);
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
function vectorCandidates(db, vector, pathPrefixes) {
    const matches = db.prepare(`
    SELECT chunk_id, distance
    FROM vault_chunk_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(JSON.stringify(vector), CANDIDATE_LIMIT);
    if (matches.length === 0)
        return [];
    const byId = new Map(matches.map((match) => [match.chunk_id, match.distance]));
    const placeholders = matches.map(() => "?").join(",");
    const rows = db.prepare(`
    SELECT c.chunk_id, c.path, n.title, c.heading, c.start_line, c.end_line,
           c.content, n.content AS note_content
    FROM vault_chunks AS c
    JOIN vault_notes AS n ON n.path = c.path
    WHERE c.chunk_id IN (${placeholders})
  `).all(...matches.map((match) => match.chunk_id));
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
export async function searchVault(options) {
    const query = options.query.replace(/\s+/g, " ").trim();
    if (!query)
        return [];
    const limit = Math.max(1, Math.min(options.limit || DEFAULT_LIMIT, 50));
    if (options.rebuild)
        rebuildVaultIndex(options.dataDir);
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
    let queryVector = null;
    try {
        queryVector = await (options.embed || defaultEmbed)(query);
    }
    catch {
        queryVector = null;
    }
    const vector = queryVector ? vectorCandidates(db, queryVector, options.pathPrefixes) : [];
    return applyRetrievalPolicy(vector, keyword, query, options.statuses, options.memoryScope).slice(0, limit);
}
export function defaultDataDir(home = process.env.HOME || "/tmp") {
    return join(home, ".local", "share", "obsidian-agent-tools");
}
