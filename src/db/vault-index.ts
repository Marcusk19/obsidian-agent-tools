import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export const VAULT_INDEX_FILENAME = "vault-index.db";
export const VAULT_INDEX_MODEL = "nomic-embed-text";
export const VAULT_INDEX_DIM = 768;

export type VaultIndexDatabase = Database.Database;

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

function initializeSchema(db: VaultIndexDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO vault_index_meta (key, value)
      VALUES ('schema_version', '1');
    INSERT OR IGNORE INTO vault_index_meta (key, value)
      VALUES ('embedding_model', '${VAULT_INDEX_MODEL}');

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

    CREATE VIRTUAL TABLE IF NOT EXISTS vault_note_fts USING fts5(
      content,
      title,
      path UNINDEXED,
      tokenize = 'porter'
    );

    CREATE TABLE IF NOT EXISTS vault_note_vec_map (
      path TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vault_note_vec USING vec0(
      embedding float[${VAULT_INDEX_DIM}],
      +path TEXT,
      +title TEXT,
      +content TEXT
    );
  `);
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
