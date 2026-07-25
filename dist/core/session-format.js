import { homedir } from "node:os";
export function validateNormalizedSession(value) {
    if (!value || typeof value !== "object")
        throw new Error("session input must be an object");
    const input = value;
    if (input.runtime !== "claude-code" && input.runtime !== "pi") {
        throw new Error("session runtime must be claude-code or pi");
    }
    for (const key of ["sessionId", "transcript", "cwd"]) {
        if (typeof input[key] !== "string" || !input[key].trim()) {
            throw new Error(`session ${key} is required`);
        }
    }
    return {
        runtime: input.runtime,
        sessionId: input.sessionId.trim(),
        transcript: input.transcript,
        cwd: input.cwd.trim(),
        startedAt: typeof input.startedAt === "string" ? input.startedAt : undefined,
        endedAt: typeof input.endedAt === "string" ? input.endedAt : undefined,
    };
}
export function formatTranscript(transcript, config) {
    const text = transcript.trim();
    const turns = text.split(/\n\s*\n/).filter((part) => /^\[(user|assistant)\]:/m.test(part));
    if (turns.length < config.summaryMinTurns || text.length < config.summaryMinChars)
        return null;
    if (text.length <= config.summaryMaxChars)
        return text;
    return `${text.slice(0, config.summaryMaxChars).trimEnd()}\n\n[...truncated]`;
}
export function shortenCwd(cwd, home = process.env.HOME || homedir()) {
    return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}
export function parseSummaryResponse(text) {
    const taggedTopic = text.match(/<topic>\s*([\s\S]*?)\s*<\/topic>/i)?.[1]?.trim();
    const taggedSummary = text.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i)?.[1]?.trim();
    const cleaned = text.replace(/<\/?(?:topic|summary)>/gi, "").trim();
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const topic = taggedTopic || lines[0];
    let summary = taggedSummary || lines.slice(1).join(" ").trim();
    if (summary === topic)
        summary = "";
    if (!topic || !summary || topic.length > 60)
        return null;
    if (/^#{1,6}\s|```/m.test(summary))
        return null;
    return { topic, summary };
}
function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
function formatDuration(startedAt, endedAt) {
    const milliseconds = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
        return null;
    const totalMinutes = Math.floor(milliseconds / 60_000);
    if (totalMinutes < 1)
        return `${Math.floor(milliseconds / 1_000)}s`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
export function renderSessionEntry(session, result, time) {
    const timing = session.startedAt && session.endedAt
        ? `\n**Started:** \`${formatTimestamp(session.startedAt)}\`\n**Ended:** \`${formatTimestamp(session.endedAt)}\`${formatDuration(session.startedAt, session.endedAt) ? `\n**Duration:** \`${formatDuration(session.startedAt, session.endedAt)}\`` : ""}`
        : "";
    return `### ${time} — ${result.topic}\n\n${result.summary}\n\n**Runtime:** \`${session.runtime}\`\n**Session:** \`${session.sessionId}\`${timing}\n**CWD:** \`${shortenCwd(session.cwd)}\`\n`;
}
