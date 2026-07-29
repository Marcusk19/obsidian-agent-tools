import { basename, extname } from "node:path";
const VECTOR_WEIGHT = 0.65;
const TEXT_WEIGHT = 0.35;
const PATH_BOOST_MAX = 0.15;
function termsFor(text) {
    return text.match(/[\p{L}\p{N}_-]+/gu) || [];
}
function section(content, heading) {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
    if (start === -1)
        return undefined;
    const collected = [];
    for (const line of lines.slice(start + 1)) {
        if (/^##\s+/.test(line))
            break;
        collected.push(line);
    }
    return collected.join("\n").trim() || undefined;
}
function compact(content, maxChars) {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
function excerpt(candidate, query) {
    const rule = section(candidate.noteContent, "Rule");
    if (rule) {
        const appliesWhen = section(candidate.noteContent, "Applies when");
        return [compact(rule, 360), appliesWhen ? `Applies when: ${compact(appliesWhen, 140)}` : ""]
            .filter(Boolean)
            .join(" ");
    }
    const terms = termsFor(query);
    const lower = candidate.content.toLowerCase();
    const positions = terms
        .map((term) => lower.indexOf(term.toLowerCase()))
        .filter((position) => position >= 0);
    const position = positions.length > 0 ? Math.min(...positions) : 0;
    const start = Math.max(0, position - 120);
    const end = Math.min(candidate.content.length, start + 400);
    return compact(candidate.content.slice(start, end), 400);
}
function frontmatter(content) {
    return content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
}
function matchesStatus(content, statuses) {
    if (!statuses?.length)
        return true;
    const metadata = frontmatter(content);
    if (!metadata)
        return false;
    const statusMatch = metadata.match(/^status:\s*(.+)$/m);
    if (!statusMatch)
        return false;
    const value = statusMatch[1].trim().toLowerCase();
    return statuses.some((status) => status.toLowerCase() === value);
}
function isExpired(content, today = new Date()) {
    const metadata = frontmatter(content);
    const match = metadata?.match(/^valid_until:\s*(.+)$/m);
    if (!match)
        return false;
    const value = match[1].trim();
    const expiry = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T23:59:59.999Z`)
        : new Date(value);
    return Number.isFinite(expiry.getTime()) && expiry.getTime() < today.getTime();
}
function normalizeScope(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function matchesMemoryScope(content, context) {
    if (!context)
        return true;
    const metadata = frontmatter(content);
    if (!metadata)
        return false;
    const lines = metadata.split(/\r?\n/);
    const scopeStart = lines.findIndex((line) => /^scope:\s*/.test(line));
    if (scopeStart === -1)
        return false;
    const rawScopeLines = [lines[scopeStart].replace(/^scope:\s*/, "")];
    for (const line of lines.slice(scopeStart + 1)) {
        if (/^[a-zA-Z_-]+:\s*/.test(line))
            break;
        rawScopeLines.push(line);
    }
    const rawScopes = rawScopeLines.join("\n");
    if (/\bglobal\b/i.test(rawScopes))
        return true;
    const repository = normalizeScope(context.repository || "");
    const project = normalizeScope(context.project || "");
    const queryTerms = new Set(termsFor(context.query || "").map(normalizeScope).filter((term) => term.length > 2));
    for (const match of rawScopes.matchAll(/(?:^|\n)\s*-?\s*(repository|project|tool|topic)\s*:\s*([^\n]+)/gi)) {
        const kind = match[1].toLowerCase();
        const value = normalizeScope(match[2]);
        if (kind === "repository" && repository && (value === repository || value.endsWith(` ${repository}`)))
            return true;
        if (kind === "project" && project && value === project)
            return true;
        if ((kind === "tool" || kind === "topic") && value.split(" ").some((term) => queryTerms.has(term)))
            return true;
    }
    return false;
}
function matchesFilters(content, statuses, memoryScope) {
    return !isExpired(content) && matchesStatus(content, statuses) && matchesMemoryScope(content, memoryScope);
}
function pathBoost(candidate, query) {
    const normalizedQuery = normalizeScope(query);
    if (!normalizedQuery)
        return 0;
    const values = [
        candidate.path,
        basename(candidate.path),
        basename(candidate.path, extname(candidate.path)),
        candidate.title,
        candidate.heading,
    ].map(normalizeScope).filter(Boolean);
    if (values.some((value) => value === normalizedQuery))
        return PATH_BOOST_MAX;
    const queryTerms = termsFor(normalizedQuery);
    if (queryTerms.length > 0 && values.some((value) => queryTerms.every((term) => value.includes(normalizeScope(term))))) {
        return PATH_BOOST_MAX / 2;
    }
    return 0;
}
/**
 * Applies retrieval policy in one place: eligibility, score merging, path
 * boosts, per-note deduplication, and excerpt/provenance shaping.
 */
export function applyRetrievalPolicy(vector, keyword, query, statuses, memoryScope) {
    const merged = new Map();
    for (const candidate of [...vector, ...keyword]) {
        const existing = merged.get(candidate.chunkId);
        if (!existing) {
            merged.set(candidate.chunkId, { ...candidate });
            continue;
        }
        existing.vectorScore = Math.max(existing.vectorScore, candidate.vectorScore);
        existing.textScore = Math.max(existing.textScore, candidate.textScore);
        existing.keywordConfirmed ||= candidate.keywordConfirmed;
    }
    const bestByPath = new Map();
    for (const candidate of merged.values()) {
        if (!matchesFilters(candidate.noteContent, statuses, memoryScope))
            continue;
        const score = VECTOR_WEIGHT * candidate.vectorScore + TEXT_WEIGHT * candidate.textScore + pathBoost(candidate, query);
        const existing = bestByPath.get(candidate.path);
        if (!existing || score > existing.score)
            bestByPath.set(candidate.path, { candidate, score });
    }
    return [...bestByPath.values()]
        .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path))
        .map(({ candidate, score }) => ({
        path: candidate.path,
        title: candidate.title,
        heading: candidate.heading,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        excerpt: excerpt(candidate, query),
        score,
        semanticScore: candidate.vectorScore,
        lexicalScore: candidate.textScore,
        keywordConfirmed: candidate.keywordConfirmed,
        confidence: candidate.keywordConfirmed ? "confirmed" : "semantic",
    }));
}
