#!/usr/bin/env bash
# AFK runner for sandcastle.
#
# Loops `npm run sandcastle` until the agent emits the COMPLETE signal, with
# crash resilience: relaunches on transient crashes (up to a consecutive-failure
# cap and a hard launch ceiling), and relaunches on a clean exit that hit
# maxIterations without finishing the backlog.
#
# Result flow: leaves all work on WSL `main` (sandcastle auto-merges via
# merge-to-head). It does NOT push — review/push manually when back.
#
# Usage:   bash .sandcastle/run-afk.sh
# Tunables (env): MAX_RESTARTS (default 6), MAX_CONSEC_FAIL (default 3)
set -uo pipefail

REPO="$HOME/nes-tetris-trainer"
cd "$REPO" || { echo "repo not found: $REPO" >&2; exit 1; }

MAX_RESTARTS="${MAX_RESTARTS:-6}"
MAX_CONSEC_FAIL="${MAX_CONSEC_FAIL:-3}"
COMPLETE_STR='<promise>COMPLETE</promise>'

RUN_TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$REPO/.sandcastle/logs"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/afk-$RUN_TS.summary.log"

log() { echo "[afk $(date +%H:%M:%S)] $*" | tee -a "$SUMMARY"; }

launches=0
consec_fail=0
status="UNKNOWN"

log "AFK run started. repo=$REPO max_restarts=$MAX_RESTARTS max_consec_fail=$MAX_CONSEC_FAIL"
log "HEAD before: $(git -C "$REPO" log --oneline -1)"

while (( launches < MAX_RESTARTS )); do
  launches=$((launches+1))

  # Prune worktrees orphaned by a previous crashed launch (safe: only removes
  # entries whose directory is already gone). Skip on the first launch.
  if (( launches > 1 )); then
    git -C "$REPO" worktree prune 2>>"$SUMMARY" || true
  fi

  RLOG="$LOG_DIR/afk-$RUN_TS.launch-$launches.log"
  log "launch #$launches -> $RLOG"

  npm run sandcastle 2>&1 | tee "$RLOG"
  rc=${PIPESTATUS[0]}

  if grep -qF "$COMPLETE_STR" "$RLOG"; then
    log "launch #$launches: COMPLETE signal seen (rc=$rc). Backlog drained."
    status="COMPLETE"
    break
  fi

  if (( rc == 0 )); then
    log "launch #$launches: clean exit (rc=0) without COMPLETE — likely hit maxIterations. Relaunching to continue."
    consec_fail=0
    continue
  fi

  consec_fail=$((consec_fail+1))
  log "launch #$launches: FAILED rc=$rc (consecutive failures: $consec_fail/$MAX_CONSEC_FAIL)"
  if (( consec_fail >= MAX_CONSEC_FAIL )); then
    log "Too many consecutive failures. Aborting."
    status="ABORTED_FAILURES"
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

# Exit non-zero unless we drained the backlog cleanly, so callers/schedulers
# can detect an unhealthy run.
[[ "$status" == "COMPLETE" ]] && exit 0 || exit 1
