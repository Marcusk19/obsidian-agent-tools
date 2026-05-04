import AnthropicVertex from "@anthropic-ai/vertex-sdk";

const SYSTEM_PROMPT = `You are a session summarizer for Claude Code conversations. Produce a concise summary of the following coding session.

Output format:
- First line: a short topic (under 60 chars, no prefix, no markdown)
- Remaining lines: 3-5 sentence summary

Focus on:
- What was accomplished (features, fixes, refactors)
- Key decisions made
- Files or areas of code touched
- Unresolved issues or next steps

Only include facts explicitly stated in the conversation. Do not speculate.
Do not include preamble, JSON, or formatting — just the topic line followed by the summary.`;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const TIMEOUT_MS = 30_000;

/**
 * Call Claude via Vertex AI to summarize a transcript.
 * Returns { topic, summary } or null on failure.
 */
export async function summarizeTranscript(
  formattedTranscript: string
): Promise<{ topic: string; summary: string } | null> {
  const client = new AnthropicVertex({
    projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
    region: process.env.CLOUD_ML_REGION || "global",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: formattedTranscript }],
      },
      { signal: controller.signal }
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? (b as { text: string }).text : ""))
      .join("\n")
      .trim();

    if (!text) return null;

    // First line is topic, rest is summary
    const lines = text.split("\n");
    const topic = lines[0].trim();
    const summary = lines
      .slice(1)
      .join("\n")
      .trim();

    if (!topic || !summary) return null;

    return { topic, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`vertex: summarization failed: ${msg}\n`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
