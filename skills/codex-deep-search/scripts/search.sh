#!/usr/bin/env bash
set -euo pipefail

DEFAULT_RESULT_DIR="/Users/yizhi/.openclaw/workspace/data/codex-deep-search"
DEFAULT_WORKDIR="/Users/yizhi/.openclaw/workspace"
DEFAULT_SOP_WEB_PATH="/Users/yizhi/.openclaw/workspace/SOP/SOP_HQ_Web_Research.md"
DEFAULT_SOP_DEEP_PATH="/Users/yizhi/.openclaw/workspace/SOP/SOP_HQ_Deep_Research.md"

RESULT_DIR="${RESULT_DIR:-$DEFAULT_RESULT_DIR}"
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
CODEX_BIN="${CODEX_BIN:-$(command -v codex || true)}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-/Users/yizhi/.openclaw/openclaw.json}"
SOP_WEB_PATH="${SOP_WEB_PATH:-$DEFAULT_SOP_WEB_PATH}"
SOP_DEEP_PATH="${SOP_DEEP_PATH:-$DEFAULT_SOP_DEEP_PATH}"

PROMPT=""
TASK_NAME=""
TELEGRAM_GROUP=""
TIMEOUT_SEC=300
WORKDIR="$DEFAULT_WORKDIR"
MODEL=""
WAKE_MODE="now"
DRY_RUN=0
NO_WEB_SEARCH=0
SOP_MODE="${SOP_MODE:-auto}"
SOP_PATH=""
EFFECTIVE_SOP_MODE=""
EFFECTIVE_SOP_PATH=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/search.sh --prompt "<query>" [options]

Options:
  --prompt <text>            Research prompt (required)
  --task-name <name>         Task name (default: codex-search-YYYYmmdd-HHMMSS)
  --telegram-group <chatid>  Telegram chat/group id for status callback
  --timeout <sec>            Timeout seconds (default: 300)
  --workdir <dir>            Codex execution directory (default: /Users/yizhi/.openclaw/workspace)
  --result-dir <dir>         Output root directory
  --model <id>               Codex model override
  --sop <mode>               SOP mode: auto|web|deep|off (default: auto)
  --sop-path <file>          Optional SOP file override
  --wake-mode <mode>         OpenClaw wake mode: now|next-heartbeat (default: now)
  --no-web-search            Disable Codex --search flag
  --dry-run                  Print planned command without execution
  -h, --help                 Show help

Environment overrides:
  RESULT_DIR, OPENCLAW_BIN, CODEX_BIN, OPENCLAW_CONFIG, SOP_WEB_PATH, SOP_DEEP_PATH, SOP_MODE

Examples:
  bash scripts/search.sh --prompt "Summarize today's AI news" --task-name ai-news --sop web
  bash scripts/search.sh --prompt "Compare architecture options for a high-risk migration" --sop deep --timeout 600
  bash scripts/search.sh --prompt "Compare vector databases" --telegram-group -100123456 --sop auto
EOF
}

log() {
  printf '[codex-deep-search] %s\n' "$*"
}

err() {
  printf '[codex-deep-search][error] %s\n' "$*" >&2
}

infer_sop_mode() {
  local q
  q="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  if printf '%s' "$q" | grep -Eiq 'architecture|security|compliance|legal|finance|investment|strategy|migration|policy|governance|high[ -]?impact|kpi|rollout|production|incident|postmortem|架构|安全|合规|法律|财务|投资|策略|迁移|治理|高风险|生产|事故'; then
    printf 'deep'
    return 0
  fi
  printf 'web'
}

resolve_sop_mode() {
  case "$SOP_MODE" in
    auto)
      EFFECTIVE_SOP_MODE="$(infer_sop_mode "$PROMPT")"
      ;;
    web|deep|off)
      EFFECTIVE_SOP_MODE="$SOP_MODE"
      ;;
    *)
      err "--sop must be auto|web|deep|off"
      exit 1
      ;;
  esac

  if [[ "$EFFECTIVE_SOP_MODE" == "off" ]]; then
    EFFECTIVE_SOP_PATH=""
    return 0
  fi

  if [[ -n "$SOP_PATH" ]]; then
    EFFECTIVE_SOP_PATH="$SOP_PATH"
    return 0
  fi

  if [[ "$EFFECTIVE_SOP_MODE" == "deep" ]]; then
    EFFECTIVE_SOP_PATH="$SOP_DEEP_PATH"
    return 0
  fi
  EFFECTIVE_SOP_PATH="$SOP_WEB_PATH"
}

send_telegram() {
  local msg="$1"
  if [[ -z "$TELEGRAM_GROUP" || -z "$OPENCLAW_BIN" ]]; then
    return 0
  fi
  "$OPENCLAW_BIN" message send \
    --channel telegram \
    --target "$TELEGRAM_GROUP" \
    --message "$msg" >/dev/null 2>&1 || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)
      [[ $# -lt 2 ]] && { err "missing value for --prompt"; exit 1; }
      PROMPT="$2"
      shift 2
      ;;
    --task-name)
      [[ $# -lt 2 ]] && { err "missing value for --task-name"; exit 1; }
      TASK_NAME="$2"
      shift 2
      ;;
    --telegram-group)
      [[ $# -lt 2 ]] && { err "missing value for --telegram-group"; exit 1; }
      TELEGRAM_GROUP="$2"
      shift 2
      ;;
    --timeout)
      [[ $# -lt 2 ]] && { err "missing value for --timeout"; exit 1; }
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --workdir)
      [[ $# -lt 2 ]] && { err "missing value for --workdir"; exit 1; }
      WORKDIR="$2"
      shift 2
      ;;
    --result-dir)
      [[ $# -lt 2 ]] && { err "missing value for --result-dir"; exit 1; }
      RESULT_DIR="$2"
      shift 2
      ;;
    --model)
      [[ $# -lt 2 ]] && { err "missing value for --model"; exit 1; }
      MODEL="$2"
      shift 2
      ;;
    --sop)
      [[ $# -lt 2 ]] && { err "missing value for --sop"; exit 1; }
      SOP_MODE="$2"
      shift 2
      ;;
    --sop-path)
      [[ $# -lt 2 ]] && { err "missing value for --sop-path"; exit 1; }
      SOP_PATH="$2"
      shift 2
      ;;
    --wake-mode)
      [[ $# -lt 2 ]] && { err "missing value for --wake-mode"; exit 1; }
      WAKE_MODE="$2"
      shift 2
      ;;
    --no-web-search)
      NO_WEB_SEARCH=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  err "--prompt is required"
  usage
  exit 1
fi

if [[ -z "$CODEX_BIN" ]]; then
  err "codex not found in PATH"
  exit 1
fi

if [[ ! -d "$WORKDIR" ]]; then
  err "workdir not found: $WORKDIR"
  exit 1
fi

if [[ ! "$TIMEOUT_SEC" =~ ^[0-9]+$ ]]; then
  err "--timeout must be an integer"
  exit 1
fi

if [[ "$WAKE_MODE" != "now" && "$WAKE_MODE" != "next-heartbeat" ]]; then
  err "--wake-mode must be now or next-heartbeat"
  exit 1
fi

resolve_sop_mode

TASK_NAME="${TASK_NAME:-codex-search-$(date +%Y%m%d-%H%M%S)}"
TASK_DIR="${RESULT_DIR%/}/$TASK_NAME"
mkdir -p "$TASK_DIR"

PROMPT_FILE="$TASK_DIR/prompt.txt"
RAW_FILE="$TASK_DIR/raw_output.log"
LAST_MSG_FILE="$TASK_DIR/last_message.txt"
META_FILE="$TASK_DIR/meta.env"

cat > "$PROMPT_FILE" <<EOF
You are a deep research assistant. Use web search to investigate the question below and produce a high-quality answer with strict evidence discipline.

Question:
$PROMPT

Output requirements:
1. Start with "Key conclusions" (max 5 bullets)
2. Then provide "Evidence and sources", each with a link
3. Add "Uncertainties and risks"
4. Add "Actionable next steps"
5. Answer in the same language as the question
EOF

if [[ "$EFFECTIVE_SOP_MODE" != "off" ]]; then
  cat >> "$PROMPT_FILE" <<EOF

SOP enforcement:
- SOP mode: $EFFECTIVE_SOP_MODE
- Primary SOP file path: $EFFECTIVE_SOP_PATH
- Before finalizing the answer, read that SOP file from disk if available and follow its hard gates.
- If the SOP file is unavailable, follow the compact gates below.
EOF

  if [[ "$EFFECTIVE_SOP_MODE" == "web" ]]; then
    cat >> "$PROMPT_FILE" <<'EOF'

Compact SOP gates (HQ-Web-Research):
1. Normalize target/scope/output first.
2. Use <= 3 search queries by default.
3. Select exactly Top3 sources with authority mix.
4. Fetch full text for Top2 authoritative sources.
5. Every conclusion line must include at least one citation URL.
6. Critical claims require >=2 independent sources.
7. If evidence conflicts, mark Conflict/Unclear and provide a minimal verification plan.
EOF
  else
    cat >> "$PROMPT_FILE" <<'EOF'

Compact SOP gates (HQ-Deep-Research):
1. Build a claim map (3-7 claims) before deep synthesis.
2. Use 4-6 queries including counter-evidence.
3. Provide dual-track evidence: external + internal implementation evidence when relevant.
4. Use >=6 sources with >=3 authoritative external sources.
5. Critical claims require >=2 independent citations.
6. Include option matrix (>=3 options) and explicit recommendation tradeoffs.
7. Include rollout v1/v2 with KPI targets and stop/rollback conditions.
8. If unresolved conflict remains, keep bounded uncertainty explicit.
EOF
  fi
fi

if [[ -n "$OPENCLAW_BIN" ]]; then
  cat >> "$PROMPT_FILE" <<EOF

When completely finished, run this command exactly once:
$OPENCLAW_BIN system event --text "Done: codex-deep-search task $TASK_NAME finished." --mode $WAKE_MODE
EOF
fi

CMD=("$CODEX_BIN")
if [[ "$NO_WEB_SEARCH" -eq 0 ]]; then
  CMD+=("--search")
fi
CMD+=("exec" "--full-auto" "--skip-git-repo-check" "--cd" "$WORKDIR")
if [[ -n "$MODEL" ]]; then
  CMD+=("--model" "$MODEL")
fi
CMD+=("--output-last-message" "$LAST_MSG_FILE" "-")

COMMAND_PREVIEW="$(printf '%q ' "${CMD[@]}")"

cat > "$META_FILE" <<EOF
TASK_NAME=$TASK_NAME
TASK_DIR=$TASK_DIR
WORKDIR=$WORKDIR
RESULT_DIR=$RESULT_DIR
CODEX_BIN=$CODEX_BIN
OPENCLAW_BIN=$OPENCLAW_BIN
OPENCLAW_CONFIG=$OPENCLAW_CONFIG
TIMEOUT_SEC=$TIMEOUT_SEC
NO_WEB_SEARCH=$NO_WEB_SEARCH
WAKE_MODE=$WAKE_MODE
MODEL=$MODEL
SOP_MODE=$SOP_MODE
EFFECTIVE_SOP_MODE=$EFFECTIVE_SOP_MODE
SOP_PATH=$SOP_PATH
EFFECTIVE_SOP_PATH=$EFFECTIVE_SOP_PATH
COMMAND=$COMMAND_PREVIEW
EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run mode"
  log "task_name=$TASK_NAME"
  log "task_dir=$TASK_DIR"
  log "sop_mode=$SOP_MODE"
  log "effective_sop_mode=$EFFECTIVE_SOP_MODE"
  log "effective_sop_path=$EFFECTIVE_SOP_PATH"
  log "command=$COMMAND_PREVIEW"
  log "prompt_file=$PROMPT_FILE"
  exit 0
fi

send_telegram "codex-deep-search started: $TASK_NAME"

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_SEC" "${CMD[@]}" < "$PROMPT_FILE" > "$RAW_FILE" 2>&1
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$TIMEOUT_SEC" "${CMD[@]}" < "$PROMPT_FILE" > "$RAW_FILE" 2>&1
    return $?
  fi
  {
    echo "[warning] timeout/gtimeout not found; running without hard timeout."
  } > "$RAW_FILE"
  "${CMD[@]}" < "$PROMPT_FILE" >> "$RAW_FILE" 2>&1
}

set +e
run_with_timeout
EXIT_CODE=$?
set -e

STATUS="success"
if [[ "$EXIT_CODE" -eq 124 || "$EXIT_CODE" -eq 137 ]]; then
  STATUS="timeout"
elif [[ "$EXIT_CODE" -ne 0 ]]; then
  STATUS="failed"
fi

{
  echo "EXIT_CODE=$EXIT_CODE"
  echo "STATUS=$STATUS"
  echo "FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$META_FILE"

log "task_name=$TASK_NAME"
log "status=$STATUS"
log "task_dir=$TASK_DIR"
log "raw_output=$RAW_FILE"
log "last_message=$LAST_MSG_FILE"

if [[ "$STATUS" == "success" ]]; then
  send_telegram "codex-deep-search done: $TASK_NAME"
  exit 0
fi

if [[ "$STATUS" == "timeout" ]]; then
  send_telegram "codex-deep-search timeout: $TASK_NAME"
else
  send_telegram "codex-deep-search failed: $TASK_NAME (code=$EXIT_CODE)"
fi
exit "$EXIT_CODE"
