import { type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
import { type MemoryScopeContext, type VaultSearchResult } from "./retrieval-policy.js";
export type { MemoryScopeContext, VaultSearchResult } from "./retrieval-policy.js";
export interface VaultSearchOptions {
    query: string;
    vaultPath: string;
    dataDir: string;
    limit?: number;
    embed?: typeof defaultEmbed;
    db?: VaultIndexDatabase;
    rebuild?: boolean;
    pathPrefixes?: string[];
    statuses?: string[];
    memoryScope?: MemoryScopeContext;
    semantic?: boolean;
}
/**
 * Synchronizes the vault and applies retrieval policy before returning results.
 * The database option lets tests and internal callers reuse an already-synced index.
 */
export declare function searchVault(options: VaultSearchOptions): Promise<VaultSearchResult[]>;
export declare function defaultDataDir(home?: string): string;
