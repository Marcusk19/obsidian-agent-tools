import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type { VaultIndexDatabase } from "../db/vault-index.js";
import { EMBEDDING_DIM, embed as defaultEmbed } from "./embed.js";

export interface SyncReport {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  keywordOnly: number;
  failed: number;
}

export interface SyncVaultOptions {
  vaultPath: string;
  db: VaultIndexDatabase;
  embed?: typeof defaultEmbed;
  force?: boolean;
}

interface FileEntry {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  mtimeMs: number;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function titleFor(path: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(path, extname(path));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function enumerateMarkdown(directory: string, vaultPath: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...enumerateMarkdown(fullPath, vaultPath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      paths.push(normalizePath(relative(vaultPath, fullPath)));
    }
  }
  return paths.sort();
}

function readEntry(vaultPath: string, path: string): FileEntry {
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

function removeVector(db: VaultIndexDatabase, path: string): void {
  const mapping = db.prepare("SELECT vec_rowid FROM vault_note_vec_map WHERE path = ?").get(path) as { vec_rowid: number } | undefined;
  if (mapping) db.prepare("DELETE FROM vault_note_vec WHERE rowid = ?").run(mapping.vec_rowid);
  db.prepare("DELETE FROM vault_note_vec_map WHERE path = ?").run(path);
}

function removeNote(db: VaultIndexDatabase, path: string): void {
  removeVector(db, path);
  db.prepare("DELETE FROM vault_note_fts WHERE path = ?").run(path);
  db.prepare("DELETE FROM vault_notes WHERE path = ?").run(path);
}

function previousNote(db: VaultIndexDatabase, path: string): { content_hash: string; mtime_ms: number; embedding_status: string } | undefined {
  return db.prepare("SELECT content_hash, mtime_ms, embedding_status FROM vault_notes WHERE path = ?").get(path) as { content_hash: string; mtime_ms: number; embedding_status: string } | undefined;
}

async function indexEntry(
  db: VaultIndexDatabase,
  entry: FileEntry,
  makeEmbedding: typeof defaultEmbed,
  force: boolean,
  report: SyncReport,
): Promise<void> {
  const previous = previousNote(db, entry.path);
  if (!force && previous?.content_hash === entry.contentHash && previous.mtime_ms === entry.mtimeMs) {
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
  db.prepare("INSERT INTO vault_note_fts (content, title, path) VALUES (?, ?, ?)").run(entry.content, entry.title, entry.path);

  let vector: number[] | null = null;
  let errorMessage: string | null = null;
  try {
    vector = await makeEmbedding(`${entry.title}\n${entry.content}`);
    if (vector && vector.length !== EMBEDDING_DIM) {
      throw new Error(`Expected ${EMBEDDING_DIM}-dimensional embedding, got ${vector.length}`);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  if (vector) {
    const result = db.prepare(
      "INSERT INTO vault_note_vec (embedding, path, title, content) VALUES (?, ?, ?, ?)"
    ).run(JSON.stringify(vector), entry.path, entry.title, entry.content);
    db.prepare("INSERT INTO vault_note_vec_map (path, vec_rowid) VALUES (?, ?)").run(entry.path, result.lastInsertRowid);
    db.prepare("UPDATE vault_notes SET embedding_status = 'ready' WHERE path = ?").run(entry.path);
  } else {
    db.prepare("UPDATE vault_notes SET embedding_status = 'failed', last_embedding_error = ? WHERE path = ?").run(errorMessage || "Embedding unavailable", entry.path);
    report.keywordOnly++;
    report.failed++;
  }

  if (isUpdate) report.updated++;
  else report.added++;
}

export async function syncVaultIndex(options: SyncVaultOptions): Promise<SyncReport> {
  const report: SyncReport = { scanned: 0, added: 0, updated: 0, unchanged: 0, deleted: 0, keywordOnly: 0, failed: 0 };
  const makeEmbedding = options.embed || defaultEmbed;
  const paths = enumerateMarkdown(options.vaultPath, options.vaultPath);
  const seen = new Set(paths);

  for (const path of paths) {
    report.scanned++;
    try {
      await indexEntry(options.db, readEntry(options.vaultPath, path), makeEmbedding, options.force === true, report);
    } catch (error) {
      report.failed++;
      console.error(`vault index: failed to read/index ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const indexed = options.db.prepare("SELECT path FROM vault_notes").all() as Array<{ path: string }>;
  for (const { path } of indexed) {
    if (!seen.has(path)) {
      removeNote(options.db, path);
      report.deleted++;
    }
  }

  return report;
}
