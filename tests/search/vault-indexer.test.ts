import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeVaultIndex,
  openVaultIndex,
  VAULT_INDEX_FINGERPRINT,
  type VaultIndexDatabase,
} from "../../src/db/vault-index.js";
import { chunkMarkdown, syncVaultIndex } from "../../src/search/vault-indexer.js";

const vectors = () => Array(768).fill(0.1);

let root = "";
let db: VaultIndexDatabase;
afterEach(() => {
  if (db?.open) closeVaultIndex(db);
  if (root) rmSync(root, { recursive: true, force: true });
});

function setup(): { vaultPath: string; dataDir: string } {
  root = mkdtempSync(join(tmpdir(), "vault-index-test-"));
  const vaultPath = join(root, "vault");
  const dataDir = join(root, "data");
  mkdirSync(vaultPath, { recursive: true });
  db = openVaultIndex(dataDir);
  return { vaultPath, dataDir };
}

describe("vault indexer", () => {
  it("creates an isolated schema and indexes new notes once", async () => {
    const { vaultPath, dataDir } = setup();
    writeFileSync(join(vaultPath, "note.md"), "# Note\ncontent");
    const embed = vi.fn().mockResolvedValue(vectors());

    const first = await syncVaultIndex({ vaultPath, db, embed });
    const second = await syncVaultIndex({ vaultPath, db, embed });

    expect(first.added).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(embed).toHaveBeenCalledOnce();
    expect(dataDir).toContain("vault-index-test-");
    expect(db.prepare("SELECT title FROM vault_notes WHERE path = ?").get("note.md")).toMatchObject({ title: "Note" });
  });

  it("updates changed notes and removes deleted notes", async () => {
    const { vaultPath } = setup();
    writeFileSync(join(vaultPath, "note.md"), "old");
    await syncVaultIndex({ vaultPath, db, embed: vi.fn().mockResolvedValue(vectors()) });
    writeFileSync(join(vaultPath, "note.md"), "new");
    const updated = await syncVaultIndex({ vaultPath, db, embed: vi.fn().mockResolvedValue(vectors()) });
    expect(updated.updated).toBe(1);
    expect(db.prepare("SELECT content FROM vault_notes WHERE path = ?").get("note.md")).toMatchObject({ content: "new" });

    unlinkSync(join(vaultPath, "note.md"));
    const deleted = await syncVaultIndex({ vaultPath, db, embed: vi.fn().mockResolvedValue(vectors()) });
    expect(deleted.deleted).toBe(1);
    expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = ?").get("note.md")).toBeUndefined();
  });

  it("keeps keyword indexing when embedding is unavailable", async () => {
    const { vaultPath } = setup();
    writeFileSync(join(vaultPath, "memory.md"), "explicit vault selector");
    const embed = vi.fn().mockResolvedValue(null);
    await syncVaultIndex({ vaultPath, db, embed });
    await syncVaultIndex({ vaultPath, db, embed });

    expect(embed).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT embedding_status FROM vault_notes WHERE path = ?").get("memory.md")).toMatchObject({ embedding_status: "failed" });
    expect(db.prepare("SELECT path FROM vault_chunk_fts WHERE vault_chunk_fts MATCH ?").get('"selector"')).toMatchObject({ path: "memory.md" });
  });

  it("defers embeddings during keyword-only sync and adds them on semantic sync", async () => {
    const { vaultPath } = setup();
    writeFileSync(join(vaultPath, "memory.md"), "fast lexical memory");
    const embed = vi.fn().mockResolvedValue(vectors());

    await syncVaultIndex({ vaultPath, db, embed, keywordOnly: true });
    expect(embed).not.toHaveBeenCalled();
    expect(db.prepare("SELECT embedding_status FROM vault_notes WHERE path = ?").get("memory.md"))
      .toMatchObject({ embedding_status: "skipped" });

    await syncVaultIndex({ vaultPath, db, embed });
    expect(embed).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT embedding_status FROM vault_notes WHERE path = ?").get("memory.md"))
      .toMatchObject({ embedding_status: "ready" });
  });

  it("chunks Markdown on headings and overlaps oversized sections", () => {
    const longSection = Array.from({ length: 12 }, (_, index) => `line-${index} ${"word ".repeat(45)}`).join("\n");
    const chunks = chunkMarkdown("note.md", `---\nstatus: active\n---\n# Root\n\n## Details\n${longSection}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.heading.includes("Root"))).toBe(true);
    const detailChunks = chunks.filter((chunk) => chunk.heading === "Root › Details");
    expect(detailChunks.length).toBeGreaterThan(1);
    expect(detailChunks[1].startLine).toBeLessThanOrEqual(detailChunks[0].endLine);
    expect(chunks[0].content).not.toContain("status: active");
  });

  it("invalidates derived rows when the index fingerprint changes", () => {
    const { dataDir } = setup();
    db.prepare("INSERT INTO vault_notes (path, title, content, content_hash, mtime_ms, embedding_status) VALUES ('old.md', 'Old', 'old', 'hash', 1, 'ready')").run();
    db.prepare("UPDATE vault_index_meta SET value = 'outdated' WHERE key = 'index_fingerprint'").run();
    closeVaultIndex(db);

    db = openVaultIndex(dataDir);

    expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = 'old.md'").get()).toBeUndefined();
    expect(db.prepare("SELECT value FROM vault_index_meta WHERE key = 'index_fingerprint'").get())
      .toMatchObject({ value: VAULT_INDEX_FINGERPRINT });
  });

  it("indexes generated session summaries", async () => {
    const { vaultPath } = setup();
    mkdirSync(join(vaultPath, "4_Archive", "_agent_sessions"), { recursive: true });
    writeFileSync(join(vaultPath, "4_Archive", "_agent_sessions", "2026-01-01.md"), "# Session\nsummary");
    const report = await syncVaultIndex({ vaultPath, db, embed: vi.fn().mockResolvedValue(vectors()) });
    expect(report.added).toBe(1);
    expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = ?").get("4_Archive/_agent_sessions/2026-01-01.md")).toBeTruthy();
    expect(db.prepare("SELECT heading, start_line, end_line FROM vault_chunks WHERE path = ?").get("4_Archive/_agent_sessions/2026-01-01.md"))
      .toMatchObject({ heading: "Session", start_line: 1, end_line: 2 });
  });
});
