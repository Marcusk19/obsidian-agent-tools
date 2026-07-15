#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="$(mktemp -d)"
INPUT="$(mktemp)"
trap 'rm -rf "$VAULT" "$INPUT"' EXIT

cat > "$INPUT" <<'JSON'
{"runtime":"pi","sessionId":"smoke-test","transcript":"[user]: Please summarize this sufficiently long local smoke test session with meaningful work.\n\n[assistant]: The implementation was built and verified locally. The next step is to inspect the generated Markdown entry and confirm its metadata.","cwd":"/tmp/obsidian-agent-tools"}
JSON

npm --prefix "$ROOT" run build >/dev/null
if ! curl --silent --fail "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/tags" >/dev/null; then
  echo "Ollama is unavailable; run npm test for the offline verification." >&2
  exit 2
fi

OBSIDIAN_VAULT="$VAULT" "$ROOT/bin/obsidian-agent-summarize" "$INPUT"
DATE="$(date +%Y-%m-%d)"
OUTPUT="$VAULT/4_Archive/_agent_sessions/$DATE.md"
test -s "$OUTPUT"
grep -Fq '**Runtime:** `pi`' "$OUTPUT"
grep -Fq '**Session:** `smoke-test`' "$OUTPUT"
grep -Fq '**CWD:** `/tmp/obsidian-agent-tools`' "$OUTPUT"
echo "Smoke test passed: $OUTPUT"
