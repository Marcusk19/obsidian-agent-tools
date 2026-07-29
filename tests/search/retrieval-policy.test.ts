import { describe, expect, it } from "vitest";
import { applyRetrievalPolicy, type RetrievalCandidate } from "../../src/search/retrieval-policy.js";

function candidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    chunkId: "note.md:0",
    path: "3_Resource/note.md",
    title: "Note",
    heading: "Context",
    startLine: 1,
    endLine: 3,
    content: "The retrieval seam keeps ranking local.",
    noteContent: "# Note\n\nThe retrieval seam keeps ranking local.",
    vectorScore: 0,
    textScore: 0,
    keywordConfirmed: false,
    ...overrides,
  };
}

describe("applyRetrievalPolicy", () => {
  it("merges lexical and semantic candidates, then returns one result per note", () => {
    const results = applyRetrievalPolicy(
      [candidate({ vectorScore: 0.9 })],
      [candidate({ textScore: 1, keywordConfirmed: true })],
      "retrieval seam",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: "3_Resource/note.md",
      semanticScore: 0.9,
      lexicalScore: 1,
      keywordConfirmed: true,
      confidence: "confirmed",
    });
  });

  it("keeps eligibility policy out of the database path", () => {
    const results = applyRetrievalPolicy(
      [candidate({
        noteContent: "---\nstatus: active\nscope:\n  - global\n---\n# Note",
        vectorScore: 0.8,
      })],
      [candidate({
        chunkId: "expired.md:0",
        path: "3_Resource/expired.md",
        noteContent: "---\nstatus: expired\n---\n# Expired",
        textScore: 1,
        keywordConfirmed: true,
      })],
      "retrieval",
      ["active"],
      { query: "retrieval" },
    );

    expect(results.map((result) => result.path)).toEqual(["3_Resource/note.md"]);
  });

  it("produces rule excerpts without requiring vault or index setup", () => {
    const results = applyRetrievalPolicy(
      [],
      [candidate({
        noteContent: "---\nstatus: active\n---\n## Rule\nUse the retrieval seam.\n## Applies when\nTesting policy.",
        textScore: 1,
        keywordConfirmed: true,
      })],
      "retrieval",
    );

    expect(results[0].excerpt).toBe("Use the retrieval seam. Applies when: Testing policy.");
  });
});
