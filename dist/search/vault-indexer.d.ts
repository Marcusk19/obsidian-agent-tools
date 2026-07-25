import { type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
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
    keywordOnly?: boolean;
}
export interface VaultChunk {
    chunkId: string;
    path: string;
    index: number;
    heading: string;
    startLine: number;
    endLine: number;
    content: string;
    contentHash: string;
}
export declare function chunkMarkdown(path: string, content: string): VaultChunk[];
export declare function syncVaultIndex(options: SyncVaultOptions): Promise<SyncReport>;
