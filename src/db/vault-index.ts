import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "../search/embed.js";

export const VAULT_INDEX_FILENAME = "vault-index.db";
export const VAULT_INDEX_MODEL = EMBEDDING_MODEL;
export const VAULT_INDEX_DIM = EMBEDDING_DIM;
export const VAULT_INDEX_SCHEMA_VERSION = 2;
export const VAULT_CHUNK_TARGET_TOKENS = 400;
export const VAULT_CHUNK_OVERLAP_TOKENS = 80;
export const VAULT_CHUNKER_VERSION = "markdown-headings-v1";

export const VAULT_INDEX_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify({
    schemaVersion: VAULT_INDEX_SCHEMA_VERSION,
    embeddingModel: VAULT_INDEX_MODEL,
    embeddingDimension: VAULT_INDEX_DIM,
    chunker: VAULT_CHUNKER_VERSION,
    chunkTargetTokens: VAULT_CHUNK_TARGET_TOKENS,
    chunkOverlapTokens: VAULT_CHUNK_OVERLAP_TOKENS,
    sources: ["**/*.md"],
  }))
  .digest("hex");

export type VaultIndexDatabase = Database.Database;

export interface VaultIndexStatus {
  schemaVersion: string | undefined;
  fingerprint: string | undefined;
  embeddingModel: string | undefined;
  embeddingDimension: string | undefined;
  chunkerVersion: string | undefined;
  notes: number;
  chunks: number;
  readyEmbeddings: number;
  failedEmbeddings: number;
  skippedEmbeddings: number;
}

export interface VaultNoteRecord {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  mtimeMs: number;
  embeddingStatus: "pending" | "ready" | "failed" | "skipped";
  lastEmbeddingError: string | null;
  lastEmbeddingAttempt: string | null;
}

export function vaultIndexPath(dataDir: string): string {
  return join(dataDir, VAULT_INDEX_FILENAME);
}

export function openVaultIndex(dataDir: string): VaultIndexDatabase {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(vaultIndexPath(dataDir));
  db.pragma("journal_mode = WAL");
  sqliteVec.load(db);
  initializeSchema(db);
  return db;
}

function metaValue(db: VaultIndexDatabase, key: string): string | undefined {
  return (db.prepare("SELECT value FROM vault_index_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

function dropDerivedSchema(db: VaultIndexDatabase): void {
  db.exec(`
    DROP TABLE IF EXISTS vault_note_vec;
    DROP TABLE IF EXISTS vault_note_vec_map;
    DROP TABLE IF EXISTS vault_note_fts;
    DROP TABLE IF EXISTS vault_chunk_vec;
    DROP TABLE IF EXISTS vault_chunk_vec_map;
    DROP TABLE IF EXISTS vault_chunk_fts;
    DROP TABLE IF EXISTS vault_chunks;
    DROP TABLE IF EXISTS vault_notes;
  `);
}

function initializeSchema(db: VaultIndexDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (metaValue(db, "index_fingerprint") !== VAULT_INDEX_FINGERPRINT) {
    dropDerivedSchema(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_notes (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      mtime_ms REAL NOT NULL,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      last_embedding_error TEXT,
      last_embedding_attempt TEXT
    );

    CREATE TABLE IF NOT EXISTS vault_chunks (
      chunk_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      heading TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      last_embedding_error TEXT,
      last_embedding_attempt TEXT,
      FOREIGN KEY (path) REFERENCES vault_notes(path) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS vault_chunks_path_idx ON vault_chunks(path);
    CREATE UNIQUE INDEX IF NOT EXISTS vault_chunks_path_index_idx ON vault_chunks(path, chunk_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS vault_chunk_fts USING fts5(
      content,
      title,
      heading,
      path UNINDEXED,
      chunk_id UNINDEXED,
      tokenize = 'porter'
    );

    CREATE TABLE IF NOT EXISTS vault_chunk_vec_map (
      chunk_id TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vault_chunk_vec USING vec0(
      embedding float[${VAULT_INDEX_DIM}],
      +chunk_id TEXT
    );
  `);

  const setMeta = db.prepare("INSERT OR REPLACE INTO vault_index_meta (key, value) VALUES (?, ?)");
  setMeta.run("schema_version", String(VAULT_INDEX_SCHEMA_VERSION));
  setMeta.run("embedding_model", VAULT_INDEX_MODEL);
  setMeta.run("embedding_dimension", String(VAULT_INDEX_DIM));
  setMeta.run("chunker_version", VAULT_CHUNKER_VERSION);
  setMeta.run("index_fingerprint", VAULT_INDEX_FINGERPRINT);
}

export function readVaultIndexStatus(db: VaultIndexDatabase): VaultIndexStatus {
  const value = (key: string) => metaValue(db, key);
  const count = (query: string, value?: string) => {
    const statement = db.prepare(query);
    const row = value === undefined ? statement.get() : statement.get(value);
    return (row as { count: number }).count;
  };
  return {
    schemaVersion: value("schema_version"),
    fingerprint: value("index_fingerprint"),
    embeddingModel: value("embedding_model"),
    embeddingDimension: value("embedding_dimension"),
    chunkerVersion: value("chunker_version"),
    notes: count("SELECT COUNT(*) AS count FROM vault_notes"),
    chunks: count("SELECT COUNT(*) AS count FROM vault_chunks"),
    readyEmbeddings: count("SELECT COUNT(*) AS count FROM vault_chunks WHERE embedding_status = ?", "ready"),
    failedEmbeddings: count("SELECT COUNT(*) AS count FROM vault_chunks WHERE embedding_status = ?", "failed"),
    skippedEmbeddings: count("SELECT COUNT(*) AS count FROM vault_chunks WHERE embedding_status = ?", "skipped"),
  };
}

export function rebuildVaultIndex(dataDir: string): void {
  const path = vaultIndexPath(dataDir);
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${path}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }
}

export function closeVaultIndex(db: VaultIndexDatabase): void {
  if (db.open) db.close();
}
