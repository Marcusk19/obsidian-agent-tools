import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const DATA_DIR =
  process.env.OBSIDIAN_DATA_DIR ||
  join(process.env.HOME || "/tmp", ".local", "share", "obsidian-agent-tools");

const DB_PATH = join(DATA_DIR, "summaries.db");

const EMBEDDING_DIM = 768;

let _db: Database.Database | null = null;

/**
 * Get or create the SQLite database connection.
 * Loads sqlite-vec extension and runs migrations on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Run migrations
  runMigrations(db);

  // Create vec table separately (not in migration SQL since it needs the extension loaded)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS summary_vec USING vec0(
      embedding float[${EMBEDDING_DIM}],
      +content TEXT,
      +topic TEXT,
      +session_id TEXT,
      +cwd TEXT,
      +date TEXT,
      +created_at TEXT
    );
  `);

  _db = db;
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
  );

  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_version")
    .get() as { v: number | null } | undefined;
  const currentVersion = row?.v ?? 0;

  // Find migration files relative to compiled output
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  // Migrations are copied to dist/db/migrations/ by the build
  const migrationsDir = join(thisDir, "migrations");

  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    // Fallback: try source directory
    const srcMigrationsDir = join(
      dirname(dirname(thisDir)),
      "src",
      "db",
      "migrations"
    );
    try {
      files = readdirSync(srcMigrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      // Use the source path for reading
      for (const file of files) {
        const version = parseInt(file.split("_")[0], 10);
        if (isNaN(version) || version <= currentVersion) continue;
        const sql = readFileSync(join(srcMigrationsDir, file), "utf-8");
        db.exec(sql);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(
          version
        );
      }
      return;
    } catch {
      return; // No migrations found
    }
  }

  for (const file of files) {
    const version = parseInt(file.split("_")[0], 10);
    if (isNaN(version) || version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
  }
}

/**
 * Insert a summary into all indexes (summaries table, FTS5, optionally vec).
 */
export function indexSummary(
  id: string,
  sessionId: string,
  date: string,
  cwd: string,
  topic: string,
  content: string,
  embedding: number[] | null
): void {
  const db = getDb();
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Insert into canonical table
  db.prepare(
    `INSERT OR REPLACE INTO summaries (id, session_id, date, cwd, topic, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, date, cwd, topic, content, now);

  // Insert into FTS5
  db.prepare(
    `INSERT INTO summary_fts (content, topic, session_id, cwd, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(content, topic, sessionId, cwd, date, now);

  // Insert into vec (best-effort)
  if (embedding) {
    const vecJson = JSON.stringify(embedding);
    db.prepare(
      `INSERT INTO summary_vec (embedding, content, topic, session_id, cwd, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(vecJson, content, topic, sessionId, cwd, date, now);

    const vecRowid = (
      db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }
    ).id;
    db.prepare(
      `INSERT OR REPLACE INTO summary_vec_map (summary_id, vec_rowid)
       VALUES (?, ?)`
    ).run(id, vecRowid);
  }
}
