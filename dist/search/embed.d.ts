export declare const EMBEDDING_MODEL = "nomic-embed-text";
export declare const EMBEDDING_DIM = 768;
/**
 * Generate an embedding vector via Ollama's HTTP API.
 * Returns a 768-dimensional float array, or null if Ollama is unavailable.
 */
export declare function embed(text: string): Promise<number[] | null>;
