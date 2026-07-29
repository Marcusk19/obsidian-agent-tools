#!/usr/bin/env bash
# install-claude-hooks.sh — Automate obsidian-agent-tools setup for Claude Code
#
# Usage:
#   ./scripts/install-claude-hooks.sh [--vault PATH] [--no-mcp] [--no-models] [--dry-run]
#
# Environment variables (override defaults):
#   OBSIDIAN_VAULT         Absolute path to your Obsidian vault
#   OBSIDIAN_CLI_PATH      Path to Obsidian app binary
#   OBSIDIAN_VAULT_NAME    Registered vault name for Obsidian CLI

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── colour helpers ────────────────────────────────────────────────────────────
RED="\033[0;31m"; GREEN="\033[0;32m"; YELLOW="\033[1;33m"; CYAN="\033[0;36m"; RESET="\033[0m"
info()    { printf "${CYAN}[info]${RESET}  %s\n" "$*"; }
ok()      { printf "${GREEN}[ok]${RESET}    %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
error()   { printf "${RED}[error]${RESET} %s\n" "$*" >&2; }
die()     { error "$*"; exit 1; }

# ── option parsing ────────────────────────────────────────────────────────────
OPT_VAULT="${OBSIDIAN_VAULT:-}"
OPT_NO_MCP=false
OPT_NO_MODELS=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)        OPT_VAULT="$2";  shift 2 ;;
    --vault=*)      OPT_VAULT="${1#*=}"; shift ;;
    --no-mcp)       OPT_NO_MCP=true; shift ;;
    --no-models)    OPT_NO_MODELS=true; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
done

run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf "${YELLOW}[dry-run]${RESET} %s\n" "$*"
  else
    "$@"
  fi
}

# ── prerequisites ─────────────────────────────────────────────────────────────
printf "\n${CYAN}=== obsidian-agent-tools: Claude Code installer ===${RESET}\n\n"

# Node.js
NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -n "$NODE_BIN" ]] || die "node is required (https://nodejs.org)"
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "node >= 18 required (found $(node --version))"
ok "node $(node --version)"

# Claude CLI
CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
[[ -n "$CLAUDE_BIN" ]] || die "claude CLI not found — install Claude Code first"
ok "claude CLI: $CLAUDE_BIN"

# Ollama (optional, warn only)
OLLAMA_BIN="$(command -v ollama 2>/dev/null || true)"
if [[ -z "$OLLAMA_BIN" ]]; then
  warn "ollama not found — semantic search and session summaries will be unavailable"
  warn "install: https://ollama.com"
  OPT_NO_MODELS=true
else
  ok "ollama: $OLLAMA_BIN"
fi

# ── build ─────────────────────────────────────────────────────────────────────
printf "\n${CYAN}--- build ---${RESET}\n"
cd "$REPO_DIR"

if [[ ! -d dist ]] || [[ src -nt dist ]]; then
  info "building TypeScript..."
  if [[ -f package-lock.json ]]; then
    run npm ci --silent
  elif [[ -f pnpm-lock.yaml ]]; then
    run pnpm install --frozen-lockfile --silent 2>/dev/null || run pnpm install --silent
  else
    run npm install --silent
  fi
  run npm run build
  ok "build complete"
else
  ok "dist/ is up to date"
fi

# ── vault path ────────────────────────────────────────────────────────────────
printf "\n${CYAN}--- vault ---${RESET}\n"

if [[ -z "$OPT_VAULT" ]]; then
  DEFAULT_VAULT="$HOME/obsidian-git-sync"
  if [[ -d "$DEFAULT_VAULT" ]]; then
    OPT_VAULT="$DEFAULT_VAULT"
    info "using default vault: $OPT_VAULT"
  else
    printf "Obsidian vault path: "
    read -r OPT_VAULT
    OPT_VAULT="${OPT_VAULT/#\~/$HOME}"
  fi
fi

[[ -d "$OPT_VAULT" ]] || die "vault directory not found: $OPT_VAULT"
ok "vault: $OPT_VAULT"

# ── MCP server ────────────────────────────────────────────────────────────────
printf "\n${CYAN}--- MCP server ---${RESET}\n"

if [[ "$OPT_NO_MCP" == true ]]; then
  warn "skipping MCP registration (--no-mcp)"
else
  OBSIDIAN_CLI_DEFAULT="/Applications/Obsidian.app/Contents/MacOS/obsidian"
  CLI_PATH="${OBSIDIAN_CLI_PATH:-$OBSIDIAN_CLI_DEFAULT}"

  # Remove any existing registration to allow clean re-registration.
  if claude mcp list 2>/dev/null | grep -q "^obsidian:"; then
    info "removing existing 'obsidian' MCP registration..."
    run claude mcp remove obsidian -s user 2>/dev/null || true
  fi

  info "registering MCP server..."
  MCP_CMD=(
    claude mcp add obsidian -s user
    -e "OBSIDIAN_VAULT=$OPT_VAULT"
    -e "OBSIDIAN_CLI_PATH=$CLI_PATH"
    --
    node "$REPO_DIR/dist/index.js"
  )
  run "${MCP_CMD[@]}"
  ok "MCP server registered"
fi

# ── hooks ─────────────────────────────────────────────────────────────────────
printf "\n${CYAN}--- hooks ---${RESET}\n"

# Detect OS for hooks directory
case "$(uname -s)" in
  Darwin)
    HOOKS_DIR="$HOME/Library/Application Support/Claude/hooks"
    ;;
  Linux)
    HOOKS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/hooks"
    ;;
  *)
    warn "unsupported OS; hooks dir may differ — install manually"
    HOOKS_DIR="$HOME/.config/Claude/hooks"
    ;;
esac

if [[ "$DRY_RUN" == false ]]; then
  mkdir -p "$HOOKS_DIR"
fi
ok "hooks directory: $HOOKS_DIR"

HOOKS=(on-session-end on-post-compact on-user-prompt-submit)
INTEGRATION_DIR="$REPO_DIR/integrations/claude-code"

for hook in "${HOOKS[@]}"; do
  src="$INTEGRATION_DIR/$hook"
  dst="$HOOKS_DIR/$hook"
  [[ -f "$src" ]] || die "hook source not found: $src"

  if [[ -L "$dst" ]] && [[ "$(readlink "$dst")" == "$src" ]]; then
    ok "$hook → already linked"
  elif [[ -e "$dst" ]]; then
    warn "$hook already exists (not a symlink to this repo); backing up as ${hook}.bak"
    run mv "$dst" "${dst}.bak"
    run ln -sf "$src" "$dst"
    ok "$hook → linked (backup created)"
  else
    run ln -sf "$src" "$dst"
    ok "$hook → linked"
  fi
done

# ── Ollama models ─────────────────────────────────────────────────────────────
printf "\n${CYAN}--- Ollama models ---${RESET}\n"

if [[ "$OPT_NO_MODELS" == true ]]; then
  warn "skipping model pull (--no-models or ollama not found)"
else
  for model in nomic-embed-text qwen2.5:7b; do
    if ollama list 2>/dev/null | grep -q "^${model%:*}"; then
      ok "model present: $model"
    else
      info "pulling $model (this may take a few minutes)..."
      run ollama pull "$model"
      ok "pulled: $model"
    fi
  done
fi

# ── env var guidance ──────────────────────────────────────────────────────────
printf "\n${CYAN}--- environment variables ---${RESET}\n"
cat <<ENV

Add these to your shell profile (~/.zshrc or ~/.bashrc) if the defaults don't
match your setup:

  # Required if your vault is not at ~/obsidian-git-sync
  export OBSIDIAN_VAULT="$OPT_VAULT"

  # Required for Obsidian CLI operations (set to your registered vault name)
  # export OBSIDIAN_VAULT_NAME="obsidian-git-sync"

  # Optional — override default vault structure
  # export OBSIDIAN_MEMORY_DURABLE_DIR="3_Resource/agent memory/"
  # export OBSIDIAN_PROJECTS_DIR="1_Projects"
  # export OBSIDIAN_VAULT_SECTIONS="1_Projects/,2_Areas/,3_Resource/,4_Archive/"
  # export OBSIDIAN_SESSIONS_DIR="4_Archive/_agent_sessions"

  # Optional — disable automatic memory injection
  # export OBSIDIAN_MEMORY_ENABLED=0

ENV

# ── done ──────────────────────────────────────────────────────────────────────
printf "${GREEN}=== Installation complete ===${RESET}\n\n"
info "Restart Claude Code for hooks and MCP changes to take effect."
if [[ "$OPT_NO_MODELS" == false ]] && [[ -n "$OLLAMA_BIN" ]]; then
  info "Make sure Ollama is running before starting a session: ollama serve"
fi
