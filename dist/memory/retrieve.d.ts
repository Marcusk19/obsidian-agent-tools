import type { AgentConfig } from "../core/config.js";
import { searchVault } from "../search/vault-search.js";
import type { MemoryContext, MemoryRetrievalRequest } from "./types.js";
interface RetrievalDependencies {
    search: typeof searchVault;
}
export declare function retrieveMemoryContext(request: MemoryRetrievalRequest, config: AgentConfig, dependencies?: Partial<RetrievalDependencies>): Promise<MemoryContext>;
export {};
