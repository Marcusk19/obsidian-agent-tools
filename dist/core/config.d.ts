export interface AgentConfig {
    vaultPath: string;
    dataDir: string;
    ollamaHost: string;
    summaryModel: string;
    summaryMaxChars: number;
    summaryMinTurns: number;
    summaryMinChars: number;
    memoryMaxChars: number;
    memoryMaxResults: number;
    memoryProjectResults: number;
    memoryBroadResults: number;
    /** Vault-relative prefix for durable agent-memory notes. */
    memoryDurableDir: string;
    /** Vault-relative prefix for project notes, used for project-scoped retrieval. */
    projectsDir: string;
    /**
     * Vault-relative path prefixes searched during broad retrieval.
     * An empty array means the whole vault is searched without a prefix filter.
     */
    vaultSections: string[];
    /** Vault-relative directory where session summaries are written. */
    sessionsDir: string;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): AgentConfig;
