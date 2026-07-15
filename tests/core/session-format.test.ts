import { describe, expect, it } from "vitest";
import { formatTranscript, parseSummaryResponse, renderSessionEntry, validateNormalizedSession } from "../../src/core/session-format.js";

const config = { summaryMaxChars: 20, summaryMinTurns: 2, summaryMinChars: 10 };

describe("session format", () => {
  it("validates normalized sessions", () => {
    expect(validateNormalizedSession({ runtime: "pi", sessionId: "s1", transcript: "x", cwd: "/tmp" })).toEqual({ runtime: "pi", sessionId: "s1", transcript: "x", cwd: "/tmp" });
  });

  it("filters short sessions and truncates long sessions", () => {
    expect(formatTranscript("[user]: hello", config)).toBeNull();
    const result = formatTranscript("[user]: hello world\n\n[assistant]: this is long", config);
    expect(result).toBe("[user]: hello world\n\n[...truncated]");
  });

  it("parses tagged and plain responses", () => {
    expect(parseSummaryResponse("<topic>Fix tests</topic>\n<summary>Updated the tests.</summary>")).toEqual({ topic: "Fix tests", summary: "Updated the tests." });
    expect(parseSummaryResponse("Fix tests\nUpdated the tests.")).toEqual({ topic: "Fix tests", summary: "Updated the tests." });
    expect(parseSummaryResponse("Local Smoke Test Implementation\n</topic>\nThe local implementation was verified.")).toEqual({ topic: "Local Smoke Test Implementation", summary: "The local implementation was verified." });
  });

  it("renders Pi-style metadata", () => {
    const text = renderSessionEntry({ runtime: "claude-code", sessionId: "s1", transcript: "x", cwd: `${process.env.HOME}/project` }, { topic: "Fix tests", summary: "Updated the tests." }, "10:30");
    expect(text).toContain("### 10:30 — Fix tests");
    expect(text).toContain("**Runtime:** `claude-code`");
    expect(text).toContain("**CWD:** `~/project`");
  });
});
