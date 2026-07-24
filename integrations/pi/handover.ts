import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Message } from "@earendil-works/pi-ai/compat";
import {
  BorderedLoader,
  buildContextEntries,
  convertToLlm,
  serializeConversation,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `You are preparing a handover for a fresh coding-agent session.

Turn the supplied conversation into a concise, self-contained prompt that lets the new session continue the work immediately.

Requirements:
- Summarize the user's goal, relevant context, decisions, findings, progress, unresolved questions, blockers, and concrete next steps.
- Mention relevant files, branches, commands, URLs, and working-tree cautions when they matter.
- Suggest any skills the new session should use, but only when relevant.
- Do not duplicate content already captured in artifacts such as PRDs, plans, ADRs, issues, commits, or diffs. Reference those artifacts by path or URL instead.
- Treat the supplied next-session focus, when present, as the task to prioritize and tailor the handover accordingly.
- Distinguish completed work from work that is merely proposed or pending.
- Do not invent facts or claim that checks passed unless the conversation establishes that they did.
- Output only the prompt for the new session, with no preamble or commentary.

Use this structure when applicable:
# Handover

## Goal

## Context and decisions

## Current state

## Artifacts and files

## Next task

## Suggested skills

## Constraints and cautions`;

/**
 * Build the effective conversation for handover using Pi's canonical context
 * projection, including compaction and branch summaries and custom messages.
 */
export function getHandoverMessages(branch: SessionEntry[]): AgentMessage[] {
  return buildContextEntries(branch).flatMap(sessionEntryToContextMessages);
}

export function buildHandoverRequest(conversation: string, focus: string): string {
  const focusSection = focus
    ? focus
    : "Continue the current work from the most appropriate concrete next step.";

  return `## Conversation history

${conversation}

## Next-session focus

${focusSection}`;
}

export default function handover(pi: ExtensionAPI): void {
  pi.registerCommand("handover", {
    description: "Summarize this conversation and continue it in a new Pi session",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("handover requires interactive mode", "error");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const messages = getHandoverMessages(ctx.sessionManager.getBranch());
      if (messages.length === 0) {
        ctx.ui.notify("No conversation to hand over", "error");
        return;
      }

      const conversation = serializeConversation(convertToLlm(messages));
      const request = buildHandoverRequest(conversation, args.trim());
      const parentSession = ctx.sessionManager.getSessionFile();
      const model = ctx.model;

      const summary = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
        const loader = new BorderedLoader(tui, theme, "Preparing handover...");
        loader.onAbort = () => done(null);

        const generate = async (): Promise<string | null> => {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!auth.ok || !auth.apiKey) {
            throw new Error(auth.ok ? `No API key for ${model.provider}` : auth.error);
          }

          const message: Message = {
            role: "user",
            content: [{ type: "text", text: request }],
            timestamp: Date.now(),
          };
          const response = await complete(
            model,
            { systemPrompt: SYSTEM_PROMPT, messages: [message] },
            {
              apiKey: auth.apiKey,
              headers: auth.headers,
              env: auth.env,
              signal: loader.signal,
            },
          );

          if (response.stopReason === "aborted") return null;
          const text = response.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
          if (!text) throw new Error("The model returned an empty handover");
          return text;
        };

        generate()
          .then(done)
          .catch((error) => {
            console.error("Handover generation failed:", error);
            done(null);
          });

        return loader;
      });

      if (!summary) {
        ctx.ui.notify("Handover cancelled or failed", "warning");
        return;
      }

      const result = await ctx.newSession({
        parentSession,
        withSession: async (replacementCtx) => {
          await replacementCtx.sendUserMessage(summary);
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}
