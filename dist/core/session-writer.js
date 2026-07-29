import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { renderSessionEntry } from "./session-format.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function acquireLock(path) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            const fd = openSync(path, "wx");
            closeSync(fd);
            return;
        }
        catch {
            await sleep(50);
        }
    }
    throw new Error(`timed out acquiring session log lock: ${path}`);
}
export function createSessionWriter(config) {
    return {
        async append(session, result, now = new Date()) {
            const date = now.toISOString().slice(0, 10);
            const time = now.toTimeString().slice(0, 5);
            const directory = join(config.vaultPath, config.sessionsDir);
            const filePath = join(directory, `${date}.md`);
            const lockPath = `${filePath}.lock`;
            mkdirSync(directory, { recursive: true });
            await acquireLock(lockPath);
            try {
                const entry = renderSessionEntry(session, result, time);
                const nextContent = existsSync(filePath)
                    ? `${readFileSync(filePath, "utf8").trimEnd()}\n\n---\n\n${entry}`
                    : `# Agent Sessions — ${date}\n\n${entry}`;
                const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
                writeFileSync(temporaryPath, nextContent, "utf8");
                renameSync(temporaryPath, filePath);
                return filePath;
            }
            finally {
                try {
                    unlinkSync(lockPath);
                }
                catch { /* best effort */ }
            }
        },
    };
}
