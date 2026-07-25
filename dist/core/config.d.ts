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
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): AgentConfig;
