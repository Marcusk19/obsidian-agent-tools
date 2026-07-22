export type MemoryTier = "durable" | "project" | "broad";
export type MemoryConfidence = "confirmed" | "semantic";

export interface MemoryRetrievalRequest {
  prompt: string;
  cwd?: string;
  repository?: string;
  project?: string;
  maxChars: number;
}

export interface MemoryCandidate {
  path: string;
  title: string;
  tier: MemoryTier;
  confidence: MemoryConfidence;
  excerpt: string;
  sourceHeading?: string;
  score: number;
}

export interface MemoryContext {
  candidates: MemoryCandidate[];
  rendered: string;
  truncated: boolean;
}
