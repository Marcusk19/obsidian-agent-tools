import { createOllamaClient } from "./ollama.js";
import { formatTranscript, validateNormalizedSession } from "./session-format.js";
import { createSessionWriter } from "./session-writer.js";
export function createSessionPipeline(config, dependencies = {}) {
    const ollama = dependencies.ollama || createOllamaClient(config);
    const writer = dependencies.writer || createSessionWriter(config);
    return {
        async process(input) {
            const session = validateNormalizedSession(input);
            const transcript = formatTranscript(session.transcript, config);
            if (!transcript)
                return null;
            await ollama.ensureModel();
            const result = await ollama.summarize(transcript);
            if (!result)
                return null;
            const path = await writer.append(session, result);
            return { path };
        },
    };
}
