import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { VAULT_CHUNK_OVERLAP_TOKENS, VAULT_CHUNK_TARGET_TOKENS, } from "../db/vault-index.js";
import { EMBEDDING_DIM, embed as defaultEmbed } from "./embed.js";
function normalizePath(path) {
    return path.split(sep).join("/");
}
function titleFor(path, content) {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return heading || basename(path, extname(path));
}
function hashContent(content) {
    return createHash("sha256").update(content).digest("hex");
}
function frontmatterEnd(lines) {
    if (lines[0]?.trim() !== "---")
        return 0;
    const closing = lines.slice(1).findIndex((line) => line.trim() === "---");
    return closing === -1 ? 0 : closing + 2;
}
function lineUnits(line, lineNumber) {
    const tokens = line.match(/\S+/g) ?? [];
    if (tokens.length <= VAULT_CHUNK_TARGET_TOKENS) {
        return [{ line: lineNumber, text: line, tokens: tokens.length }];
    }
    const units = [];
    for (let offset = 0; offset < tokens.length; offset += VAULT_CHUNK_TARGET_TOKENS) {
        const slice = tokens.slice(offset, offset + VAULT_CHUNK_TARGET_TOKENS);
        units.push({ line: lineNumber, text: slice.join(" "), tokens: slice.length });
    }
    return units;
}
function chunkSection(params) {
    const chunks = [];
    let start = 0;
    let index = params.nextIndex;
    while (start < params.units.length) {
        let end = start;
        let tokens = 0;
        while (end < params.units.length) {
            const next = params.units[end];
            if (end > start && tokens + next.tokens > VAULT_CHUNK_TARGET_TOKENS)
                break;
            tokens += next.tokens;
            end++;
            if (tokens >= VAULT_CHUNK_TARGET_TOKENS)
                break;
        }
        if (end === start)
            end++;
        const selected = params.units.slice(start, end);
        const content = selected.map((unit) => unit.text).join("\n").trim();
        if (content) {
            chunks.push({
                chunkId: `${params.path}:${index}`,
                path: params.path,
                index,
                heading: params.heading,
                startLine: selected[0].line,
                endLine: selected[selected.length - 1].line,
                content,
                contentHash: hashContent(`${params.heading}\n${content}`),
            });
            index++;
        }
        if (end >= params.units.length)
            break;
        let overlapStart = end;
        let overlapTokens = 0;
        while (overlapStart > start + 1 && overlapTokens < VAULT_CHUNK_OVERLAP_TOKENS) {
            overlapStart--;
            overlapTokens += params.units[overlapStart].tokens;
        }
        start = Math.max(start + 1, overlapStart);
    }
    return chunks;
}
export function chunkMarkdown(path, content) {
    const lines = content.split(/\r?\n/);
    const headings = [];
    const chunks = [];
    let sectionHeading = "";
    let sectionUnits = [];
    let nextIndex = 0;
    const flush = () => {
        const sectionChunks = chunkSection({ path, heading: sectionHeading, units: sectionUnits, nextIndex });
        chunks.push(...sectionChunks);
        nextIndex += sectionChunks.length;
        sectionUnits = [];
    };
    const bodyStart = frontmatterEnd(lines);
    for (let offset = bodyStart; offset < lines.length; offset++) {
        const line = lines[offset];
        const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (headingMatch) {
            flush();
            const level = headingMatch[1].length;
            headings.length = level - 1;
            headings[level - 1] = headingMatch[2].trim();
            sectionHeading = headings.filter(Boolean).join(" › ");
        }
        sectionUnits.push(...lineUnits(line, offset + 1));
    }
    flush();
    if (chunks.length === 0) {
        const fallback = content.trim();
        if (fallback) {
            chunks.push({
                chunkId: `${path}:0`,
                path,
                index: 0,
                heading: "",
                startLine: 1,
                endLine: Math.max(1, lines.length),
                content: fallback,
                contentHash: hashContent(fallback),
            });
        }
    }
    return chunks;
}
function enumerateMarkdown(directory, vaultPath) {
    const paths = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            paths.push(...enumerateMarkdown(fullPath, vaultPath));
        }
        else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
            paths.push(normalizePath(relative(vaultPath, fullPath)));
        }
    }
    return paths.sort();
}
function readEntry(vaultPath, path) {
    const fullPath = join(vaultPath, path);
    const content = readFileSync(fullPath, "utf8");
    const stat = statSync(fullPath);
    return {
        path,
        title: titleFor(path, content),
        content,
        contentHash: hashContent(content),
        mtimeMs: stat.mtimeMs,
    };
}
function removeChunkVector(db, chunkId) {
    const mapping = db.prepare("SELECT vec_rowid FROM vault_chunk_vec_map WHERE chunk_id = ?").get(chunkId);
    if (mapping)
        db.prepare("DELETE FROM vault_chunk_vec WHERE rowid = ?").run(mapping.vec_rowid);
    db.prepare("DELETE FROM vault_chunk_vec_map WHERE chunk_id = ?").run(chunkId);
}
function removeNote(db, path) {
    const chunks = db.prepare("SELECT chunk_id FROM vault_chunks WHERE path = ?").all(path);
    for (const { chunk_id: chunkId } of chunks)
        removeChunkVector(db, chunkId);
    db.prepare("DELETE FROM vault_chunk_fts WHERE path = ?").run(path);
    db.prepare("DELETE FROM vault_chunks WHERE path = ?").run(path);
    db.prepare("DELETE FROM vault_notes WHERE path = ?").run(path);
}
function previousNote(db, path) {
    return db.prepare("SELECT content_hash, mtime_ms, embedding_status FROM vault_notes WHERE path = ?").get(path);
}
async function indexChunk(params) {
    const { db, chunk, title } = params;
    const attempt = new Date().toISOString();
    db.prepare(`
    INSERT INTO vault_chunks
      (chunk_id, path, chunk_index, heading, start_line, end_line, content, content_hash, embedding_status, last_embedding_attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(chunk.chunkId, chunk.path, chunk.index, chunk.heading, chunk.startLine, chunk.endLine, chunk.content, chunk.contentHash, attempt);
    db.prepare("INSERT INTO vault_chunk_fts (content, title, heading, path, chunk_id) VALUES (?, ?, ?, ?, ?)")
        .run(chunk.content, title, chunk.heading, chunk.path, chunk.chunkId);
    if (params.keywordOnly) {
        db.prepare("UPDATE vault_chunks SET embedding_status = 'skipped' WHERE chunk_id = ?").run(chunk.chunkId);
        return { keywordOnly: true, failed: false, error: null };
    }
    if (params.state.embeddingUnavailable) {
        const error = "Embedding unavailable";
        db.prepare("UPDATE vault_chunks SET embedding_status = 'failed', last_embedding_error = ? WHERE chunk_id = ?").run(error, chunk.chunkId);
        return { keywordOnly: true, failed: true, error };
    }
    let vector = null;
    let errorMessage = null;
    try {
        vector = await params.makeEmbedding([title, chunk.heading, chunk.content].filter(Boolean).join("\n"));
        if (vector && vector.length !== EMBEDDING_DIM) {
            throw new Error(`Expected ${EMBEDDING_DIM}-dimensional embedding, got ${vector.length}`);
        }
        if (!vector)
            params.state.embeddingUnavailable = true;
    }
    catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
    }
    if (vector) {
        const result = db.prepare("INSERT INTO vault_chunk_vec (embedding, chunk_id) VALUES (?, ?)")
            .run(JSON.stringify(vector), chunk.chunkId);
        db.prepare("INSERT INTO vault_chunk_vec_map (chunk_id, vec_rowid) VALUES (?, ?)").run(chunk.chunkId, result.lastInsertRowid);
        db.prepare("UPDATE vault_chunks SET embedding_status = 'ready' WHERE chunk_id = ?").run(chunk.chunkId);
        return { keywordOnly: false, failed: false, error: null };
    }
    errorMessage ||= "Embedding unavailable";
    db.prepare("UPDATE vault_chunks SET embedding_status = 'failed', last_embedding_error = ? WHERE chunk_id = ?").run(errorMessage, chunk.chunkId);
    return { keywordOnly: true, failed: true, error: errorMessage };
}
async function indexEntry(db, entry, makeEmbedding, force, keywordOnly, report, state) {
    const previous = previousNote(db, entry.path);
    const contentUnchanged = previous?.content_hash === entry.contentHash && previous.mtime_ms === entry.mtimeMs;
    if (!force && contentUnchanged && (keywordOnly || previous?.embedding_status !== "skipped")) {
        report.unchanged++;
        return;
    }
    const isUpdate = Boolean(previous);
    removeNote(db, entry.path);
    const attempt = new Date().toISOString();
    db.prepare(`
    INSERT INTO vault_notes
      (path, title, content, content_hash, mtime_ms, embedding_status, last_embedding_error, last_embedding_attempt)
    VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?)
  `).run(entry.path, entry.title, entry.content, entry.contentHash, entry.mtimeMs, attempt);
    const chunks = chunkMarkdown(entry.path, entry.content);
    let noteFailed = false;
    let noteKeywordOnly = keywordOnly;
    let lastError = null;
    for (const chunk of chunks) {
        const result = await indexChunk({ db, chunk, title: entry.title, makeEmbedding, keywordOnly, state });
        noteFailed ||= result.failed;
        noteKeywordOnly ||= result.keywordOnly;
        lastError = result.error || lastError;
    }
    const status = keywordOnly ? "skipped" : noteFailed ? "failed" : "ready";
    db.prepare("UPDATE vault_notes SET embedding_status = ?, last_embedding_error = ? WHERE path = ?")
        .run(status, lastError, entry.path);
    if (noteKeywordOnly)
        report.keywordOnly++;
    if (noteFailed)
        report.failed++;
    if (isUpdate)
        report.updated++;
    else
        report.added++;
}
export async function syncVaultIndex(options) {
    const report = { scanned: 0, added: 0, updated: 0, unchanged: 0, deleted: 0, keywordOnly: 0, failed: 0 };
    const makeEmbedding = options.embed || defaultEmbed;
    const paths = enumerateMarkdown(options.vaultPath, options.vaultPath);
    const seen = new Set(paths);
    const state = { embeddingUnavailable: false };
    for (const path of paths) {
        report.scanned++;
        try {
            await indexEntry(options.db, readEntry(options.vaultPath, path), makeEmbedding, options.force === true, options.keywordOnly === true, report, state);
        }
        catch (error) {
            report.failed++;
            console.error(`vault index: failed to read/index ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const indexed = options.db.prepare("SELECT path FROM vault_notes").all();
    for (const { path } of indexed) {
        if (!seen.has(path)) {
            removeNote(options.db, path);
            report.deleted++;
        }
    }
    return report;
}
