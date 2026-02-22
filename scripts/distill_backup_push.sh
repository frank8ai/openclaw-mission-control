#!/usr/bin/env bash
set -euo pipefail

MISSION_CONTROL_DIR="/Users/yizhi/.openclaw/workspace/mission-control"
DISTILL_DIR="$MISSION_CONTROL_DIR/data/control-center/distill"
BACKUP_REPO_DIR="/Users/yizhi/.openclaw/workspace/openclaw-distill-backup"
BACKUP_DISTILL_DIR="$BACKUP_REPO_DIR/distill"
TOKEN_FILE="/Users/yizhi/.openclaw/credentials/github-token.txt"
REMOTE_URL="https://github.com/frank8ai/openclaw-distill-backup.git"
BRANCH="main"

if [[ ! -d "$MISSION_CONTROL_DIR" ]]; then
  echo "missing mission-control dir: $MISSION_CONTROL_DIR" >&2
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing github token file: $TOKEN_FILE" >&2
  exit 1
fi

GITHUB_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "github token is empty" >&2
  exit 1
fi

ASKPASS_SCRIPT="$(mktemp /tmp/openclaw-git-askpass.XXXXXX)"
cleanup() {
  rm -f "$ASKPASS_SCRIPT"
}
trap cleanup EXIT

cat >"$ASKPASS_SCRIPT" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) echo "x-access-token" ;;
  *Password*) cat "$GITHUB_TOKEN_FILE" ;;
  *) echo "" ;;
esac
EOF
chmod 700 "$ASKPASS_SCRIPT"
export GITHUB_TOKEN_FILE="$TOKEN_FILE"
export GIT_ASKPASS="$ASKPASS_SCRIPT"
export GIT_TERMINAL_PROMPT=0

if [[ ! -d "$BACKUP_REPO_DIR/.git" ]]; then
  rm -rf "$BACKUP_REPO_DIR"
  git clone "$REMOTE_URL" "$BACKUP_REPO_DIR"
fi

cd "$BACKUP_REPO_DIR"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REMOTE_URL"
fi

cd "$MISSION_CONTROL_DIR"
npm run tasks -- distill-export \
  --include-audit true \
  --include-codex-cli true \
  --max-sessions 10000 \
  --max-samples 200000 \
  --max-audit-events 200000 \
  --json >/tmp/openclaw-distill-export-last.json

mkdir -p "$BACKUP_DISTILL_DIR"
rsync -a --delete "$DISTILL_DIR/" "$BACKUP_DISTILL_DIR/"

cd "$BACKUP_REPO_DIR"
git add distill

if git diff --cached --quiet; then
  echo "no distill changes, skip commit/push"
  exit 0
fi

if ! git config user.name >/dev/null; then
  git config user.name "OpenClaw Backup Bot"
fi
if ! git config user.email >/dev/null; then
  git config user.email "openclaw-backup-bot@localhost"
fi

LATEST_MANIFEST="$(ls -1t distill/*.manifest.json 2>/dev/null | head -n 1 || true)"
LATEST_LABEL=""
if [[ -n "$LATEST_MANIFEST" ]]; then
  LATEST_LABEL="$(basename "$LATEST_MANIFEST")"
fi

git commit -m "backup: distill snapshot ${LATEST_LABEL:-update}"
git branch -M "$BRANCH"
git push -u origin "$BRANCH"

echo "backup push done: ${LATEST_LABEL:-unknown manifest}"
