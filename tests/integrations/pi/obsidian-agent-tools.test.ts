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

let obsidianAgentTools: (typeof import("../../../integrations/pi/obsidian-agent-tools"))['default'];
const originalMemoryTimeout = process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;

beforeAll(async () => {
  ({ default: obsidianAgentTools } = await import(new URL("../../../integrations/pi/obsidian-agent-tools.ts", import.meta.url).href));
});

describe("Pi integration", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
    delete process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;
  });

  afterAll(() => {
    if (originalMemoryTimeout === undefined) delete process.env.OBSIDIAN_MEMORY_TIMEOUT_MS;
    else process.env.OBSIDIAN_MEMORY_TIMEOUT_MS = originalMemoryTimeout;
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
    const result = await handler({ prompt: "How should this repository run tests?" }, { cwd: "/repo" });

    expect(execFileMock).toHaveBeenCalledWith(
      expect.any(String),
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
    await handlers.before_agent_start!({ prompt: "Need context" }, { cwd: "/repo" });

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
    const result = await handler({ prompt: "Need context" }, { cwd: "/repo" });

    expect(result).toBeUndefined();
  });
});
