import { loadConfig } from "../core/config.js";
import { retrieveMemoryContext } from "../memory/retrieve.js";
export interface MemoryContextArgs {
    prompt: string;
    cwd?: string;
    repository?: string;
    project?: string;
}
export declare function parseArgs(argv: string[]): MemoryContextArgs;
interface CommandDependencies {
    retrieve: typeof retrieveMemoryContext;
    loadConfig: typeof loadConfig;
    stdout: Pick<typeof process.stdout, "write">;
}
export declare function run(argv: string[], partialDeps?: Partial<CommandDependencies>): Promise<void>;
export {};
