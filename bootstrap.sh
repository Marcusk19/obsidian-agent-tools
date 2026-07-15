#!/usr/bin/env bash
# Bootstrap obsidian-agent-tools on a new device.
#
# Usage:
#   git clone <repo> && cd obsidian-agent-tools && ./bootstrap.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="${HOME}/.claude/settings.json"
HOOK_PATH="${PROJECT_DIR}/bin/on-session-end"
DATA_DIR="${HOME}/.local/share/obsidian-agent-tools"

ok() { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; }

printf '%s\n' "obsidian-agent-tools bootstrap" "==============================" "" "Checking prerequisites..."

if ! command -v node >/dev/null; then
  fail "node not found — install Node.js >= 18"
  exit 1
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $NODE_MAJOR found, need >= 18"
  exit 1
fi
ok "node $(node --version)"

if ! command -v pnpm >/dev/null; then
  fail "pnpm not found — install with: npm install -g pnpm"
  exit 1
fi
ok "pnpm $(pnpm --version)"

if command -v claude >/dev/null; then
  ok "claude CLI found"
  NO_CLAUDE=0
else
  warn "claude CLI not found — MCP and Claude hooks will not be registered"
  NO_CLAUDE=1
fi

printf '%s\n' "" "Installing dependencies..."
cd "$PROJECT_DIR"
pnpm install >/dev/null
ok "dependencies installed"
pnpm run build >/dev/null
ok "build complete"

if [ "$NO_CLAUDE" -eq 0 ]; then
  claude mcp add obsidian -s user -- node "${PROJECT_DIR}/dist/index.js" 2>/dev/null || true
  ok "MCP server registered"

  if [ ! -f "$SETTINGS_FILE" ]; then
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    printf '{}\n' > "$SETTINGS_FILE"
  fi

  node - "$SETTINGS_FILE" "$HOOK_PATH" <<'NODE'
const fs = require("fs");
const [settingsPath, hookPath] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
settings.hooks ??= {};
const existing = settings.hooks.SessionEnd ?? [];
const alreadyWired = existing.some((rule) => rule.hooks?.some((hook) => hook.command === hookPath));
if (!alreadyWired) {
  existing.push({ hooks: [{ type: "command", command: hookPath, timeout: 60 }] });
  settings.hooks.SessionEnd = existing;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
NODE
  ok "Claude Code SessionEnd hook configured"
fi

mkdir -p "$DATA_DIR"
ok "data directory: $DATA_DIR"

if command -v ollama >/dev/null && curl --silent --fail "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/tags" >/dev/null; then
  ok "Ollama available"
else
  warn "Ollama is unavailable — local summaries will be skipped until it is running"
  echo "      Install/start Ollama and run: ollama pull qwen2.5:7b"
fi

printf '%s\n' "" "Done." "Agent summaries go to:" "  - \${OBSIDIAN_VAULT:-\$HOME/obsidian-git-sync}/4_Archive/_agent_sessions/<date>.md" "  - $DATA_DIR/summaries.db" "  - $DATA_DIR/summarize.log"
