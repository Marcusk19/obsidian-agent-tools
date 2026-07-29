import Database from "better-sqlite3";
export declare const VAULT_INDEX_FILENAME = "vault-index.db";
export declare const VAULT_INDEX_MODEL = "nomic-embed-text";
export declare const VAULT_INDEX_DIM = 768;
export declare const VAULT_INDEX_SCHEMA_VERSION = 2;
export declare const VAULT_CHUNK_TARGET_TOKENS = 400;
export declare const VAULT_CHUNK_OVERLAP_TOKENS = 80;
export declare const VAULT_CHUNKER_VERSION = "markdown-headings-v1";
export declare const VAULT_INDEX_FINGERPRINT: string;
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
export declare function vaultIndexPath(dataDir: string): string;
export declare function openVaultIndex(dataDir: string): VaultIndexDatabase;
export declare function readVaultIndexStatus(db: VaultIndexDatabase): VaultIndexStatus;
export declare function rebuildVaultIndex(dataDir: string): void;
export declare function closeVaultIndex(db: VaultIndexDatabase): void;
