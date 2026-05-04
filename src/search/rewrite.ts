/**
 * Query preprocessing for search — ported from takopod/worker/search.py.
 *
 * Strips greetings, hedging phrases, and stop words while preserving
 * quoted strings and technical terms.
 */

const GREETING_PATTERN =
  /\b(hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))\b[,!.\s]*/gi;

const HEDGING_PATTERN =
  /\b(can you|could you|would you|will you|i was wondering if|i was wondering|would you mind|do you think you could|i need you to|i want you to|i'd like you to|help me with|help me|tell me about|tell me|show me|explain to me|i have a question about|quick question)\b\s*/gi;

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "having",
  "it", "its", "this", "that", "these", "those",
  "about", "just", "really", "very", "also", "actually", "basically",
  "so", "like", "well", "anyway", "right", "okay", "ok",
  "some", "any", "much", "many", "more", "most",
  "not", "no", "nor", "but", "or", "and", "if", "then",
  "of", "in", "on", "at", "to", "for", "with", "from", "by",
  "up", "out", "into", "over", "after", "before",
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "we", "our", "ours", "ourselves",
  "they", "them", "their", "theirs",
  "he", "she", "him", "her", "his", "hers",
  "there", "here",
]);

// Technical terms: dotted/hyphenated/underscored paths or camelCase
const TECHNICAL_TERM_PATTERN =
  /\b[a-zA-Z0-9]+[._-][a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*\b|\b[a-z]+[A-Z][a-zA-Z]*\b/g;

const QUOTED_STRING_PATTERN = /"[^"]+"|'[^']+'/g;

const MIN_QUERY_LENGTH = 15;

/**
 * Transform a user message into a search-optimized query.
 *
 * Returns null if the query is too short to search.
 */
export function rewriteQuery(message: string): string | null {
  if (message.trim().length < MIN_QUERY_LENGTH) return null;

  // 1. Extract and preserve quoted strings and technical terms
  const preserved: string[] = [];
  for (const match of message.matchAll(QUOTED_STRING_PATTERN)) {
    preserved.push(match[0]);
  }
  for (const match of message.matchAll(TECHNICAL_TERM_PATTERN)) {
    preserved.push(match[0]);
  }

  // 2. Strip greetings and hedging
  let text = message.replace(GREETING_PATTERN, " ");
  text = text.replace(HEDGING_PATTERN, " ");

  // 3. Strip trailing question/exclamation marks
  text = text.replace(/[?!]+/g, " ");

  // 4. Tokenize and filter stop words
  const words = text.match(/\w+/g) || [];
  const contentWords = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));

  // 5. Combine, deduplicate preserving order
  const allTerms = [...preserved, ...contentWords];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const term of allTerms) {
    const lower = term.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(term);
    }
  }

  let rewritten = deduped.join(" ").trim();

  // 6. Fallback
  if (!rewritten) {
    rewritten = message.trim();
  }

  return rewritten;
}
