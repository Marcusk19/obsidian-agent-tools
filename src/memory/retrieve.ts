import { existsSync } from "node:fs";
import { basename, dirname, parse, resolve } from "node:path";
import type { AgentConfig } from "../core/config.js";
import { rewriteQuery } from "../search/rewrite.js";
import { searchVault } from "../search/vault-search.js";
import { renderMemoryContext } from "./render.js";
import type { MemoryCandidate, MemoryContext, MemoryRetrievalRequest, MemoryTier } from "./types.js";

interface RetrievalDependencies {
  search: typeof searchVault;
}

const DURABLE_PREFIXES = ["3_Resource/agent memory/"];
const BROAD_PREFIXES = ["1_Projects/", "2_Areas/", "3_Resource/", "4_Archive/"];
const DURABLE_STATUSES = ["active"];
const BROAD_HINT = /\b(history|notes?|log|plans?|decision|decide|remember|previous|last|yesterday|today|todo|carry\s+over|on my plate)\b/i;

const defaultDependencies: RetrievalDependencies = { search: searchVault };

export async function retrieveMemoryContext(
  request: MemoryRetrievalRequest,
  config: AgentConfig,
  dependencies: Partial<RetrievalDependencies> = {},
): Promise<MemoryContext> {
  const prompt = request.prompt?.trim();
  if (!prompt) return { candidates: [], rendered: "", truncated: false };

  const query = targetedQuery(prompt);
  const repository = normalizeIdentity(request.repository || inferRepository(request.cwd));
  const project = normalizeIdentity(request.project);
  const search = { ...defaultDependencies, ...dependencies }.search;
  const seen = new Set<string>();
  const candidates: MemoryCandidate[] = [];
  const renderLimit = Math.max(1, Math.min(request.maxChars || config.memoryMaxChars, config.memoryMaxChars));

  const collectTier = async (
    tier: MemoryTier,
    limit: number,
    pathPrefixes: string[],
    options: { statuses?: string[]; durableScope?: boolean; confirmedOnly?: boolean } = {},
  ): Promise<MemoryCandidate[]> => {
    if (limit <= 0) return [];
    try {
      const results = await search({
        query,
        vaultPath: config.vaultPath,
        dataDir: config.dataDir,
        limit: Math.max(limit * 4, limit),
        pathPrefixes,
        statuses: options.statuses,
        memoryScope: options.durableScope ? { repository, project, query: prompt } : undefined,
        semantic: false,
      });
      const selected: MemoryCandidate[] = [];
      for (const result of results) {
        if (seen.has(result.path) || (options.confirmedOnly && result.confidence !== "confirmed")) continue;
        selected.push({
          path: result.path,
          title: result.title,
          tier,
          confidence: result.confidence,
          excerpt: result.excerpt,
          score: result.semanticScore,
        });
        seen.add(result.path);
        if (selected.length >= limit) break;
      }
      return selected;
    } catch (error) {
      console.warn(`memory retrieval: ${tier} search failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  candidates.push(...await collectTier("durable", config.memoryMaxResults, DURABLE_PREFIXES, {
    statuses: DURABLE_STATUSES,
    durableScope: true,
    confirmedOnly: true,
  }));

  const projectPrefixes = scopedProjectPrefixes(project, repository);
  if (projectPrefixes.length > 0) {
    candidates.push(...await collectTier("project", config.memoryProjectResults, projectPrefixes));
  }

  if (config.memoryBroadResults > 0 && BROAD_HINT.test(prompt)) {
    candidates.push(...await collectTier("broad", config.memoryBroadResults, BROAD_PREFIXES, { confirmedOnly: true }));
  }

  const { rendered, truncated } = renderMemoryContext(candidates, renderLimit);
  return { candidates, rendered, truncated };
}

function targetedQuery(prompt: string): string {
  const rewritten = rewriteQuery(prompt) || prompt;
  const questionWords = new Set(["how", "what", "when", "where", "why", "who", "which", "please", "help", "work"]);
  const terms = (rewritten.match(/"[^"]+"|'[^']+'|\S+/g) || [])
    .filter((term) => !questionWords.has(term.toLowerCase()));
  return (terms.length ? terms : [prompt]).slice(0, 3).join(" ");
}

function normalizeIdentity(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  return normalized || undefined;
}

function inferRepository(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  let current = resolve(cwd);
  const root = parse(current).root;
  while (current !== root) {
    if (existsSync(`${current}/.git`)) return basename(current);
    current = dirname(current);
  }
  return undefined;
}

function scopedProjectPrefixes(project?: string, repository?: string): string[] {
  const keys = [...new Set([project, repository].filter((value): value is string => Boolean(value)))];
  return keys.map((key) => `1_Projects/${key}`);
}
