const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "nomic-embed-text";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;

/**
 * Generate an embedding vector via Ollama's HTTP API.
 * Returns a 768-dimensional float array, or null if Ollama is unavailable.
 */
export async function embed(text: string): Promise<number[] | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, input: text }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = (await response.json()) as {
        embeddings: number[][];
      };
      return data.embeddings[0];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  process.stderr.write(
    `embed: Ollama unreachable after ${MAX_RETRIES} retries: ${lastError?.message}\n`
  );
  return null;
}
