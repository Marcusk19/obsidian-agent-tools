import type { MemoryCandidate } from "./types.js";

const TIER_ORDER: Record<MemoryCandidate["tier"], number> = {
  durable: 0,
  project: 1,
  broad: 2,
};

const CONFIDENCE_ORDER: Record<MemoryCandidate["confidence"], number> = {
  confirmed: 0,
  semantic: 1,
};

const MAX_EXCERPT_CHARS = 500;

export function renderMemoryContext(candidates: MemoryCandidate[], maxChars: number): { rendered: string; truncated: boolean } {
  if (!candidates.length || maxChars <= 0) return { rendered: "", truncated: false };

  const limit = Math.max(1, maxChars);
  const sorted = [...candidates].sort((a, b) =>
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
    || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]
    || a.score - b.score,
  );
  let rendered = "## Relevant memory";
  let truncated = false;
  if (rendered.length > limit) return { rendered: rendered.slice(0, limit), truncated: true };

  for (const candidate of sorted) {
    const heading = candidate.sourceHeading ? `#${candidate.sourceHeading}` : "";
    const prefix = `\n\n- **${candidate.title || candidate.path}**\n  Source: \`${candidate.path}${heading}\``;
    const excerpt = compact(candidate.excerpt, MAX_EXCERPT_CHARS);
    const full = excerpt ? `${prefix}\n  ${excerpt}` : prefix;

    if (rendered.length + full.length <= limit) {
      rendered += full;
      continue;
    }

    const remaining = limit - rendered.length;
    if (remaining >= prefix.length) {
      rendered += prefix;
      const excerptBudget = limit - rendered.length - 3;
      if (excerpt && excerptBudget > 1) rendered += `\n  ${compact(excerpt, excerptBudget)}`;
    }
    truncated = true;
    break;
  }

  return { rendered, truncated };
}

function compact(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return "…".slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}
