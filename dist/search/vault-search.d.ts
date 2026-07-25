import { type VaultIndexDatabase } from "../db/vault-index.js";
import { embed as defaultEmbed } from "./embed.js";
export interface MemoryScopeContext {
    repository?: string;
    project?: string;
    query?: string;
}
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
export interface VaultSearchResult {
    path: string;
    title: string;
    heading: string;
    startLine: number;
    endLine: number;
    excerpt: string;
    score: number;
    semanticScore: number;
    lexicalScore: number;
    keywordConfirmed: boolean;
    confidence: "confirmed" | "semantic";
}
export declare function searchVault(options: VaultSearchOptions): Promise<VaultSearchResult[]>;
export declare function defaultDataDir(home?: string): string;
