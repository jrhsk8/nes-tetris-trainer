"""#55 — BetaTetris normal-net **top-1 consensus** verdict (the standard gate).

The production consensus filter (`generator/src/pipeline/consensus.ts`) shells to
this. For each puzzle it asks the BetaTetris **normal** net (v1.0.0): is our
stored optimal's piece-1 outcome the net's #1 policy move? Keep iff yes.

Reuses the measurement machinery from `keeprate.py` (board injection, the
two-phase adjustment cadence, the convention-free 200-char outcome keys) but
emits a per-puzzle keep/drop **verdict** instead of an aggregate keep-rate, and
runs the **normal net only** — the `perfect` net is off-objective for a general
stacking trainer (it is trained for maxout/killscreen tetris-only play) and is
dropped from the standard path (docs/decisions.md, 2026-06-21).

**Fail-closed:** a puzzle BetaTetris cannot cleanly judge is DROPPED, and the
reason distinguishes a genuine *disagree* (rank > 1) from machinery failure so a
flaky BT run never silently inflates the cull:
  - `disagree`        — reachable but not the net's top-1 (the real cull).
  - `unreachable`     — our optimal outcome is not even in the net's move set.
  - `odd-parity`      — board parity BetaTetris's Reset cannot accept.
  - `inject-mismatch` — injected board0 round-trips wrong (engine/convention bug).
  - `bt-error`        — any exception while judging this puzzle.

  bt-run python engines/betatetris/consensus.py [keys.json] [out.json] [limit]

Defaults: keys = $BT_OUT/bank_keys.json, out = $BT_OUT/consensus_verdict.json.
Offline / generator-only (GPLv3 BetaTetris).
"""
import sys, os, json, time
import keeprate as kr  # reuse the measured, correct-cadence harness


def verdict_for(model, pz):
    """keep/drop verdict for one puzzle under the normal net. Fail-closed."""
    number, pid = pz.get('number'), pz.get('id')
    lines = kr.lines_for(pz['board'])
    if lines is None:
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'odd-parity', 'rank': None, 'inject_ok': None}
    try:
        dist, inject_ok = kr.piece1_outcome_distribution(
            model, pz['board'], pz['piece1'], pz['piece2'], lines)
    except Exception as e:  # fail-closed: never let a BT crash keep a puzzle
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'bt-error', 'rank': None, 'inject_ok': None,
                'error': str(e)[:200]}
    if not inject_ok:
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'inject-mismatch', 'rank': None, 'inject_ok': False}
    rank = kr.rank_of(dist, pz['p1_key'])
    if rank is None:
        reason = 'unreachable'
    elif rank == 1:
        reason = None
    else:
        reason = 'disagree'
    return {'number': number, 'id': pid, 'keep': rank == 1, 'reason': reason,
            'rank': rank, 'inject_ok': True, 'n_outcomes': len(dist)}


def main():
    out_dir = kr.BT_OUT
    keys_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(out_dir, 'bank_keys.json')
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(out_dir, 'consensus_verdict.json')
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None

    bank = json.load(open(keys_path))
    if limit:
        bank = bank[:limit]
    print(f"consensus: judging {len(bank)} puzzles on the NORMAL net (top-1)", flush=True)

    t0 = time.time()
    model = kr.load_model(os.path.join(kr.BT_MODELS, 'model-v1.0.0-normal.pth'))
    verdicts = []
    for i, pz in enumerate(bank):
        v = verdict_for(model, pz)
        verdicts.append(v)
        tag = 'KEEP' if v['keep'] else f"DROP/{v['reason']}"
        print(f"  {i+1}/{len(bank)} #{v['number']} {tag} rank={v['rank']}", flush=True)

    json.dump(verdicts, open(out_path, 'w'))

    kept = sum(1 for v in verdicts if v['keep'])
    disagree = sum(1 for v in verdicts if v['reason'] == 'disagree')
    unreachable = sum(1 for v in verdicts if v['reason'] == 'unreachable')
    bt_error = sum(1 for v in verdicts if v['reason'] == 'bt-error')
    other = len(verdicts) - kept - disagree - unreachable - bt_error
    n = len(verdicts)
    pct = lambda k: f"{k}/{n} ({100*k/n:.0f}%)" if n else f"{k}/0"
    print(f"\n==== CONSENSUS [normal, top-1] n={n} ====")
    print(f"   KEEP (our optimal is BT top-1):        {pct(kept)}")
    print(f"   DROP / disagree (reachable, rank>1):   {pct(disagree)}")
    print(f"   DROP / unreachable:                    {pct(unreachable)}")
    print(f"   DROP / bt-error (counted separately):  {pct(bt_error)}")
    print(f"   DROP / other (odd-parity, inject):     {pct(other)}")
    print(f"   wrote {out_path}; elapsed {int(time.time()-t0)}s", flush=True)


if __name__ == "__main__":
    main()
