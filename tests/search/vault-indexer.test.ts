import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeVaultIndex, openVaultIndex, type VaultIndexDatabase } from "../../src/db/vault-index.js";
import { syncVaultIndex } from "../../src/search/vault-indexer.js";

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
    expect(db.prepare("SELECT path FROM vault_note_fts WHERE vault_note_fts MATCH ?").get('"selector"')).toMatchObject({ path: "memory.md" });
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

  it("indexes generated session summaries", async () => {
    const { vaultPath } = setup();
    mkdirSync(join(vaultPath, "4_Archive", "_agent_sessions"), { recursive: true });
    writeFileSync(join(vaultPath, "4_Archive", "_agent_sessions", "2026-01-01.md"), "# Session\nsummary");
    const report = await syncVaultIndex({ vaultPath, db, embed: vi.fn().mockResolvedValue(vectors()) });
    expect(report.added).toBe(1);
    expect(db.prepare("SELECT 1 FROM vault_notes WHERE path = ?").get("4_Archive/_agent_sessions/2026-01-01.md")).toBeTruthy();
  });
});
