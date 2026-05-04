#!/bin/bash
# Bootstrap claude-obsidian on a new device.
# Installs deps, builds, registers MCP server, and wires up hooks.
#
# Usage:
#   git clone <repo> && cd claude-obsidian && ./bootstrap.sh
#
# Prerequisites:
#   - Node.js >= 18
#   - pnpm
#   - Claude Code CLI (claude)
#   - Ollama (optional, for vector search)
#   - GCP credentials for Vertex AI (for summarization)

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="${HOME}/.claude/settings.json"
HOOK_PATH="${PROJECT_DIR}/bin/on-session-end"
DATA_DIR="${HOME}/.local/share/claude-obsidian"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

echo "claude-obsidian bootstrap"
echo "========================="
echo ""

# --- Check prerequisites ---
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  fail "node not found — install Node.js >= 18"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $NODE_MAJOR found, need >= 18"
  exit 1
fi
ok "node $(node --version)"

if ! command -v pnpm &>/dev/null; then
  fail "pnpm not found — install with: npm install -g pnpm"
  exit 1
fi
ok "pnpm $(pnpm --version)"

if ! command -v claude &>/dev/null; then
  warn "claude CLI not found — MCP server and hooks will not be registered"
  NO_CLAUDE=1
else
  ok "claude CLI found"
  NO_CLAUDE=0
fi

echo ""

# --- Install & build ---
echo "Installing dependencies..."
cd "$PROJECT_DIR"
pnpm install 2>&1 | tail -1
ok "dependencies installed"

echo "Building..."
pnpm run build 2>&1 | tail -1
ok "build complete"

echo ""

# --- Register MCP server ---
if [ "$NO_CLAUDE" -eq 0 ]; then
  echo "Registering MCP server..."
  claude mcp add obsidian -s user -- node "${PROJECT_DIR}/dist/index.js" 2>/dev/null || true
  ok "MCP server registered (user scope)"
  echo ""
fi

# --- Wire up SessionEnd hook ---
if [ "$NO_CLAUDE" -eq 0 ]; then
  echo "Configuring SessionEnd hook..."

  if [ ! -f "$SETTINGS_FILE" ]; then
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    echo '{}' > "$SETTINGS_FILE"
  fi

  # Use node to safely merge the hook into settings.json
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));

    if (!settings.hooks) settings.hooks = {};

    const hookEntry = {
      type: 'command',
      command: '$HOOK_PATH',
      timeout: 60
    };

    // Check if already wired
    const existing = settings.hooks.SessionEnd || [];
    const alreadyWired = existing.some(r =>
      r.hooks && r.hooks.some(h => h.command && h.command.includes('claude-obsidian'))
    );

    if (!alreadyWired) {
      existing.push({ hooks: [hookEntry] });
      settings.hooks.SessionEnd = existing;
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    }
  "

  # Remove old Stop hook for on-stop if present
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
    const stopHooks = settings.hooks?.Stop;
    if (stopHooks) {
      for (const rule of stopHooks) {
        if (rule.hooks) {
          rule.hooks = rule.hooks.filter(h => !h.command?.includes('claude-obsidian'));
        }
      }
      settings.hooks.Stop = stopHooks.filter(r => r.hooks && r.hooks.length > 0);
      if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    }
  " 2>/dev/null || true

  ok "SessionEnd hook configured"
  echo ""
fi

# --- Create data directory ---
mkdir -p "$DATA_DIR"
ok "data directory: $DATA_DIR"

# --- Check optional dependencies ---
echo ""
echo "Optional dependencies:"

if command -v ollama &>/dev/null; then
  if ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    ok "Ollama + nomic-embed-text available (vector search enabled)"
  else
    warn "Ollama installed but nomic-embed-text not pulled"
    echo "      Run: ollama pull nomic-embed-text"
  fi
else
  warn "Ollama not found — vector search will be disabled (BM25 keyword search still works)"
  echo "      Install: https://ollama.com"
fi

if [ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]; then
  ok "ANTHROPIC_VERTEX_PROJECT_ID set ($ANTHROPIC_VERTEX_PROJECT_ID)"
else
  warn "ANTHROPIC_VERTEX_PROJECT_ID not set — session summarization will fail"
  echo "      Export it in your shell profile"
fi

if gcloud auth application-default print-access-token &>/dev/null 2>&1; then
  ok "GCP application-default credentials valid"
else
  warn "GCP credentials not found or expired"
  echo "      Run: gcloud auth application-default login"
fi

echo ""
echo "========================="
echo -e "${GREEN}Done.${NC} Sessions will be auto-summarized on exit."
echo ""
echo "Summaries go to:"
echo "  - Daily note: \$OBSIDIAN_VAULT_PATH/4_Archive/_daily_notes/<date>.md"
echo "  - SQLite DB:  $DATA_DIR/summaries.db"
echo "  - Logs:       $DATA_DIR/summarize.log"
