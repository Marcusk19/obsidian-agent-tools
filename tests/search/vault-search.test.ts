import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeVaultIndex, openVaultIndex, type VaultIndexDatabase } from "../../src/db/vault-index.js";
import { searchVault } from "../../src/search/vault-search.js";

let root = "";
let db: VaultIndexDatabase;
afterEach(() => {
  if (db?.open) closeVaultIndex(db);
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("vault search", () => {
  it("searches semantically first and confirms only semantic candidates", async () => {
    root = mkdtempSync(join(tmpdir(), "vault-search-test-"));
    const vaultPath = join(root, "vault");
    const dataDir = join(root, "data");
    mkdirSync(join(vaultPath, "3_Resource", "agent memory"), { recursive: true });
    writeFileSync(join(vaultPath, "3_Resource", "agent memory", "cli.md"), "Use an explicit vault selector.");
    writeFileSync(join(vaultPath, "unrelated.md"), "A note about gardening.");
    const vectorFor = (text: string) => Array(768).fill(text.includes("explicit vault selector") ? 0.9 : 0.1);
    const embed = vi.fn().mockImplementation(async (text: string) => vectorFor(text));
    db = openVaultIndex(dataDir);

    const results = await searchVault({ query: "explicit vault selector", vaultPath, dataDir, db, embed });

    expect(results[0]).toMatchObject({
      path: "3_Resource/agent memory/cli.md",
      keywordConfirmed: true,
      confidence: "confirmed",
    });
    expect(results.find((result) => result.path === "unrelated.md")).toMatchObject({
      keywordConfirmed: false,
      confidence: "semantic",
    });
  });

  it("falls back to broad keyword search when embeddings are unavailable", async () => {
    root = mkdtempSync(join(tmpdir(), "vault-search-test-"));
    const vaultPath = join(root, "vault");
    const dataDir = join(root, "data");
    mkdirSync(vaultPath, { recursive: true });
    writeFileSync(join(vaultPath, "memory.md"), "explicit vault selector");
    db = openVaultIndex(dataDir);

    const results = await searchVault({ query: "explicit vault selector", vaultPath, dataDir, db, embed: vi.fn().mockResolvedValue(null) });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ path: "memory.md", confidence: "confirmed", keywordConfirmed: true });
  });

  it("rebuilds from Markdown without reading the legacy database", async () => {
    root = mkdtempSync(join(tmpdir(), "vault-search-test-"));
    const vaultPath = join(root, "vault");
    const dataDir = join(root, "data");
    mkdirSync(vaultPath, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(vaultPath, "note.md"), "rebuildable note");
    writeFileSync(join(dataDir, "summaries.db"), "legacy");

    await searchVault({ query: "rebuildable", vaultPath, dataDir, rebuild: true, embed: vi.fn().mockResolvedValue(null) });

    expect(readFileSync(join(dataDir, "summaries.db"), "utf8")).toBe("legacy");
  });
});
