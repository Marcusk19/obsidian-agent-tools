export interface SearchVaultArgs {
    command: "vault";
    query: string;
    limit: number;
    rebuild: boolean;
}
export declare function parseArgs(args: string[]): SearchVaultArgs;
export declare function run(args: string[]): Promise<void>;
