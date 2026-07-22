import { describe, expect, it } from "vitest";
import { renderMemoryContext } from "../../src/memory/render.js";

const candidate = {
  path: "3_Resource/agent memory/rule.md",
  title: "Use the documented test command",
  tier: "durable" as const,
  confidence: "confirmed" as const,
  excerpt: "Use pnpm test for this repository.",
  score: 0.1,
};

describe("renderMemoryContext", () => {
  it("renders compact guidance and provenance without ranking metadata", () => {
    const result = renderMemoryContext([candidate], 2_000);

    expect(result.rendered).toContain("## Relevant memory");
    expect(result.rendered).toContain("Use pnpm test for this repository.");
    expect(result.rendered).toContain("3_Resource/agent memory/rule.md");
    expect(result.rendered).not.toContain("confirmed");
    expect(result.rendered).not.toContain("durable");
    expect(result.truncated).toBe(false);
  });

  it("preserves the source path and never exceeds the configured budget", () => {
    const result = renderMemoryContext([{ ...candidate, excerpt: "x".repeat(1_000) }], 180);

    expect(result.rendered).toContain("3_Resource/agent memory/rule.md");
    expect(result.rendered.length).toBeLessThanOrEqual(180);
    expect(result.truncated).toBe(true);
  });
});
