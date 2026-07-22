import { afterEach, describe, expect, it, vi } from "vitest";

const readFileSyncMock = vi.fn();
const execFileMock = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

const scriptPath = new URL("../../../integrations/claude-code/on-user-prompt-submit", import.meta.url).href;

describe("Claude Code prompt hook", () => {
  afterEach(() => {
    vi.resetModules();
    readFileSyncMock.mockReset();
    execFileMock.mockReset();
  });

  it("emits system context when retrieval succeeds", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ prompt: "How should I test?", cwd: "/repo", session_id: "abc" }));
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(null, "## Relevant memory context", "");
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await import(scriptPath);

    expect(execFileMock).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("\"system_context\":\"## Relevant memory context\""));

    writeSpy.mockRestore();
  });

  it("falls back to the original payload when retrieval fails", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ prompt: "Need context", session_id: "xyz" }));
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback?.(new Error("fail"), "", "");
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await import(scriptPath);

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("\"session_id\":\"xyz\""));
    const output = writeSpy.mock.calls.at(-1)?.[0] ?? "";
    expect(output).not.toContain("system_context");

    writeSpy.mockRestore();
  });
});
