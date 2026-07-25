import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
const spawnMock = vi.fn(() => ({ unref: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: execFileMock,
    spawn: spawnMock,
  };
});

let obsidianAgentTools: (typeof import("../../../integrations/pi/obsidian-agent-tools"))["default"];
const originalMemoryTimeout = process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;
const originalMemoryEnabled = process.env.OBSIDIAN_MEMORY_ENABLED;
const originalContextExecutable = process.env.OBSIDIAN_AGENT_CONTEXT;
const originalSummarizerExecutable = process.env.OBSIDIAN_AGENT_SUMMARIZER;

beforeAll(async () => {
  ({ default: obsidianAgentTools } = await import(new URL("../../../integrations/pi/obsidian-agent-tools.ts", import.meta.url).href));
});

describe("Pi integration", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ unref: vi.fn() });
    delete process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;
    delete process.env.OBSIDIAN_MEMORY_ENABLED;
    delete process.env.OBSIDIAN_AGENT_CONTEXT;
    delete process.env.OBSIDIAN_AGENT_SUMMARIZER;
  });

  afterAll(() => {
    if (originalMemoryTimeout === undefined) delete process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;
    else process.env.OBSIDIAN_MEMORY_TIMEOUT_MS = originalMemoryTimeout;
    if (originalMemoryEnabled === undefined) delete process.env.OBSIDIAN_MEMORY_ENABLED;
    else process.env.OBSIDIAN_MEMORY_ENABLED = originalMemoryEnabled;
    if (originalContextExecutable === undefined) delete process.env.OBSIDIAN_AGENT_CONTEXT;
    else process.env.OBSIDIAN_AGENT_CONTEXT = originalContextExecutable;
    if (originalSummarizerExecutable === undefined) delete process.env.OBSIDIAN_AGENT_SUMMARIZER;
    else process.env.OBSIDIAN_AGENT_SUMMARIZER = originalSummarizerExecutable;
  });

  it("injects memory context before the agent turn", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback?.(null, "## Relevant memory context", "");
    });
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;

    obsidianAgentTools(pi);
    expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
    const handler = handlers.before_agent_start!;
    const result = await handler(
      { prompt: "How should this repository run tests?", systemPrompt: "Base prompt" },
      { cwd: "/repo" },
    );

    expect(execFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/bin\/obsidian-agent-context$/),
      expect.any(Array),
      expect.objectContaining({ timeout: 5_000 }),
      expect.any(Function),
    );
    expect(result).toEqual({
      message: {
        customType: "obsidian-memory",
        content: "## Relevant memory context",
        display: false,
      },
      systemPrompt: expect.stringContaining("Base prompt\n\n# Obsidian Agent Memory"),
    });
  });

  it("honors a configured retrieval timeout", async () => {
    process.env.OBSIDIAN_MEMORY_TIMEOUT_MS = "8000";
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback?.(null, "", "");
    });
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;

    obsidianAgentTools(pi);
    await handlers.before_agent_start!({ prompt: "Need context", systemPrompt: "Base prompt" }, { cwd: "/repo" });

    expect(execFileMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeout: 8_000 }),
      expect.any(Function),
    );
  });

  it("fails open when context retrieval errors", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback?.(new Error("context error"), "", "");
    });
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;

    obsidianAgentTools(pi);
    const handler = handlers.before_agent_start!;
    const result = await handler({ prompt: "Need context", systemPrompt: "Base prompt" }, { cwd: "/repo" });

    expect(result).toEqual({
      systemPrompt: expect.stringContaining("# Obsidian Agent Memory"),
    });
  });

  it("preserves the memory opt-out", async () => {
    process.env.OBSIDIAN_MEMORY_ENABLED = "0";
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;

    obsidianAgentTools(pi);
    const result = await handlers.before_agent_start!({ prompt: "Need context", systemPrompt: "Base prompt" }, { cwd: "/repo" });

    expect(result).toBeUndefined();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("honors an explicitly configured context executable", async () => {
    process.env.OBSIDIAN_AGENT_CONTEXT = "/custom/obsidian-agent-context";
    execFileMock.mockImplementation((_cmd, _args, _options, callback) => {
      callback?.(null, "", "");
    });
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;

    obsidianAgentTools(pi);
    await handlers.before_agent_start!({ prompt: "Need context", systemPrompt: "Base prompt" }, { cwd: "/repo" });

    expect(execFileMock).toHaveBeenCalledWith(
      "/custom/obsidian-agent-context",
      expect.any(Array),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("uses the packaged summarizer on quit", async () => {
    const handlers: Record<string, (event: any, ctx: any) => Promise<any> | any> = {};
    const pi = { on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => { handlers[event] = handler; }) } as any;
    const branch = [
      { type: "message", timestamp: "2026-07-23T10:00:00Z", message: { role: "user", content: "Please summarize this session after we finish enough meaningful implementation work to exceed the minimum transcript length." } },
      { type: "message", timestamp: "2026-07-23T10:01:00Z", message: { role: "assistant", content: "Implemented the requested packaging changes while preserving the existing memory retrieval and detached session summarization behavior." } },
    ];

    obsidianAgentTools(pi);
    await handlers.session_shutdown!({ reason: "quit" }, {
      cwd: "/repo",
      sessionManager: {
        getBranch: () => branch,
        getSessionFile: () => "/sessions/example.jsonl",
      },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/bin\/obsidian-agent-summarize$/),
      [expect.stringMatching(/session\.json$/)],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
  });
});
