#!/usr/bin/env bash
# AFK runner for sandcastle.
#
# Loops `npm run sandcastle` until the backlog is drained, with crash resilience.
# Stop detection: a clean launch (rc=0) that produced NO new commits means
# sandcastle found nothing it could complete — backlog drained or all remaining
# issues blocked. (The agent's COMPLETE promise is written to a separate
# per-worker log, not this wrapper's stdout, so we detect "done" by lack of
# commit progress rather than by grepping for the promise string.)
#
# Result flow: leaves all work on WSL `main` (sandcastle auto-merges via
# merge-to-head). It does NOT push — review/push manually when back.
#
# Memory hygiene: sandcastle leaves its sandbox container running `sleep
# infinity` after a run; left alone it pins its working set and the run's page
# cache in the WSL VM until autoMemoryReclaim slowly drains it. This wrapper
# reaps the container between launches and on exit, then drops the page cache,
# so Windows gets the RAM back promptly instead of hours later.
#
# Usage:   bash .sandcastle/run-afk.sh
# Tunables (env): MAX_RESTARTS (default 40), MAX_CONSEC_FAIL (default 3)
set -uo pipefail

REPO="$HOME/nes-tetris-trainer"
cd "$REPO" || { echo "repo not found: $REPO" >&2; exit 1; }

MAX_RESTARTS="${MAX_RESTARTS:-40}"
MAX_CONSEC_FAIL="${MAX_CONSEC_FAIL:-3}"

RUN_TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$REPO/.sandcastle/logs"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/afk-$RUN_TS.summary.log"

log() { echo "[afk $(date +%H:%M:%S)] $*" | tee -a "$SUMMARY"; }

# --- memory hygiene -------------------------------------------------------
# Reap any sandcastle sandbox container(s) left running. Best-effort: a zombie
# left by a prior hard VM kill refuses `docker rm -f` ("did not receive an exit
# event"), but its RAM is already freed and it clears when dockerd restarts
# (e.g. after `wsl --shutdown` — systemd brings the engine back) — so we note it
# and move on rather than failing the run.
reap_sandcastle_containers() {
  local ids
  ids=$(docker ps -aq --filter "name=^sandcastle-" 2>/dev/null) || return 0
  [ -n "$ids" ] || return 0
  log "reaping leftover sandcastle container(s): $(echo "$ids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  docker rm -f $ids >>"$SUMMARY" 2>&1 \
    || log "  note: a container would not die (zombie from a prior hard kill); its RAM is already freed — clears when dockerd restarts (wsl --shutdown / systemd)."
}

# Drop the WSL VM's page cache so the freed RAM returns to Windows now rather
# than on autoMemoryReclaim's slow schedule. dev has no passwordless sudo, so
# do it from a throwaway privileged root container that shares the VM kernel.
reclaim_wsl_memory() {
  local img="sandcastle:nes-tetris-trainer"
  docker image inspect "$img" >/dev/null 2>&1 || return 0
  if docker run --rm --privileged --user 0 --entrypoint sh "$img" \
       -c 'sync; echo 3 > /proc/sys/vm/drop_caches' >>"$SUMMARY" 2>&1; then
    log "dropped page cache — WSL will hand the freed RAM back to Windows."
  fi
}

cleanup() {
  reap_sandcastle_containers
  git -C "$REPO" worktree prune 2>>"$SUMMARY" || true
  reclaim_wsl_memory
}
trap cleanup EXIT

# Best-effort count of open GitHub issues, for final status labelling only.
# Returns -1 if it can't determine (no token/network) — never blocks the run.
open_issue_count() {
  local tok slug
  tok=$(grep -E '^GH_TOKEN=' "$REPO/.sandcastle/.env" 2>/dev/null | head -1 | cut -d= -f2-)
  slug=$(git -C "$REPO" config --get remote.origin.url 2>/dev/null | sed -E 's#.*github.com[:/]##; s#\.git$##')
  [ -n "$tok" ] && [ -n "$slug" ] || { echo -1; return; }
  curl -s -H "Authorization: token $tok" \
    "https://api.github.com/repos/$slug/issues?state=open&per_page=100" 2>/dev/null \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(len([i for i in d if "pull_request" not in i]))
except Exception:
    print(-1)' 2>/dev/null || echo -1
}

launches=0
consec_fail=0
status="UNKNOWN"

log "AFK run started. repo=$REPO max_restarts=$MAX_RESTARTS max_consec_fail=$MAX_CONSEC_FAIL"
log "HEAD before: $(git -C "$REPO" log --oneline -1)"

while (( launches < MAX_RESTARTS )); do
  launches=$((launches+1))

  # Reap any sandcastle container left over from a prior launch/session before
  # starting a fresh sandbox, so they don't accumulate and pin memory.
  reap_sandcastle_containers

  # Prune worktrees orphaned by a previous crashed launch (safe). Skip first.
  if (( launches > 1 )); then
    git -C "$REPO" worktree prune 2>>"$SUMMARY" || true
  fi

  RLOG="$LOG_DIR/afk-$RUN_TS.launch-$launches.log"
  head_before=$(git -C "$REPO" rev-parse HEAD)
  log "launch #$launches -> $RLOG"

  npm run sandcastle 2>&1 | tee "$RLOG"
  rc=${PIPESTATUS[0]}

  head_after=$(git -C "$REPO" rev-parse HEAD)
  new_commits=$(git -C "$REPO" rev-list --count "${head_before}..${head_after}" 2>/dev/null || echo 0)

  if (( rc == 0 )); then
    if (( new_commits == 0 )); then
      open=$(open_issue_count)
      if [ "$open" = "0" ]; then
        status="COMPLETE"
        log "launch #$launches: clean exit, 0 new commits, 0 open issues — backlog drained."
      else
        status="NO_PROGRESS"
        log "launch #$launches: clean exit, 0 new commits, ${open} issue(s) still open (likely blocked) — stopping."
      fi
      break
    fi
    log "launch #$launches: clean exit, ${new_commits} new commit(s) — relaunching to continue the backlog."
    consec_fail=0
    continue
  fi

  consec_fail=$((consec_fail+1))
  log "launch #$launches: FAILED rc=$rc, ${new_commits} new commit(s) (consecutive failures: $consec_fail/$MAX_CONSEC_FAIL)"
  if (( consec_fail >= MAX_CONSEC_FAIL )); then
    status="ABORTED_FAILURES"
    log "Too many consecutive failures. Aborting."
    break
  fi
  log "backing off 10s before relaunch..."
  sleep 10
done

if [[ "$status" == "UNKNOWN" ]]; then
  status="HIT_RESTART_CEILING"
fi

log "=== AFK run finished: status=$status launches=$launches ==="
log "Recent commits (work is on WSL main, UNPUSHED):"
git -C "$REPO" log --oneline -10 | tee -a "$SUMMARY"
log "Summary: $SUMMARY"

# COMPLETE and NO_PROGRESS both mean "nothing actionable left" → success.
# (cleanup() runs on EXIT — reaps the container and drops the page cache.)
case "$status" in
  COMPLETE|NO_PROGRESS) exit 0 ;;
  *) exit 1 ;;
esac
