"""#55 — BetaTetris normal-net **top-1 consensus** verdict (the standard gate).

The production consensus filter (`generator/src/pipeline/consensus.ts`) shells to
this. For each puzzle it asks the BetaTetris **normal** net (v1.0.0):

 1. **Piece 1**: is our stored optimal's piece-1 outcome the net's #1 policy
    move? (same as before)
 2. **Piece 2**: given BT's own top-1 piece-1 placement, does BT's top-1
    piece-2 placement match our stored optimal's full outcome — for ALL 7
    possible next-pieces (p3)?  Our optimal is p3-agnostic; BT's policy sees
    p3 in the observation, so we sweep all 7 and require unanimous agreement.

Keep iff BOTH pass.

Reuses the measurement machinery from `keeprate.py` (board injection, the
two-phase adjustment cadence, the convention-free 200-char outcome keys) but
emits a per-puzzle keep/drop **verdict** instead of an aggregate keep-rate, and
runs the **normal net only** — the `perfect` net is off-objective for a general
stacking trainer (it is trained for maxout/killscreen tetris-only play) and is
dropped from the standard path (.claude/docs/decisions.md, 2026-06-21).

**Fail-closed:** a puzzle BetaTetris cannot cleanly judge is DROPPED, and the
reason distinguishes a genuine *disagree* (rank > 1) from machinery failure so a
flaky BT run never silently inflates the cull:
  - `disagree`        — piece-1 reachable but not the net's top-1.
  - `disagree-p2`     — piece-1 agrees but piece-2 disagrees for >=1 of 7 p3s.
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

P2_THRESHOLD = 7  # require all 7 p3 values to agree (strictest)


def verdict_for(model, pz):
    """keep/drop verdict for one puzzle under the normal net. Fail-closed."""
    number, pid = pz.get('number'), pz.get('id')
    lines = kr.lines_for(pz['board'])
    if lines is None:
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'odd-parity', 'rank': None, 'inject_ok': None,
                'p2_agree': None, 'p2_of': None}
    try:
        dist, inject_ok = kr.piece1_outcome_distribution(
            model, pz['board'], pz['piece1'], pz['piece2'], lines)
    except Exception as e:  # fail-closed: never let a BT crash keep a puzzle
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'bt-error', 'rank': None, 'inject_ok': None,
                'p2_agree': None, 'p2_of': None, 'error': str(e)[:200]}
    if not inject_ok:
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'inject-mismatch', 'rank': None, 'inject_ok': False,
                'p2_agree': None, 'p2_of': None}
    rank = kr.rank_of(dist, pz['p1_key'])
    if rank is None:
        reason = 'unreachable'
    elif rank == 1:
        reason = None
    else:
        reason = 'disagree'
    if reason is not None:
        return {'number': number, 'id': pid, 'keep': False, 'reason': reason,
                'rank': rank, 'inject_ok': True, 'n_outcomes': len(dist),
                'p2_agree': None, 'p2_of': None}

    # Piece 1 passed — check piece 2 across all 7 possible p3 values.
    try:
        p1_premove, p1_action, _ = kr.piece1_top1_actions(
            model, pz['board'], pz['piece1'], pz['piece2'], lines)
        p2_agree = 0
        for p3_id in range(7):
            p2_dist, topped = kr.piece2_outcome_distribution(
                model, pz['board'], pz['piece1'], pz['piece2'], p3_id, lines,
                p1_premove, p1_action)
            if topped:
                continue
            p2_rank = kr.rank_of(p2_dist, pz['full_key'])
            if p2_rank == 1:
                p2_agree += 1
    except Exception as e:
        return {'number': number, 'id': pid, 'keep': False,
                'reason': 'bt-error', 'rank': rank, 'inject_ok': True,
                'n_outcomes': len(dist), 'p2_agree': None, 'p2_of': 7,
                'error': str(e)[:200]}

    keep = p2_agree >= P2_THRESHOLD
    p2_reason = None if keep else 'disagree-p2'
    return {'number': number, 'id': pid, 'keep': keep, 'reason': p2_reason,
            'rank': rank, 'inject_ok': True, 'n_outcomes': len(dist),
            'p2_agree': p2_agree, 'p2_of': 7}


def main():
    out_dir = kr.BT_OUT
    keys_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(out_dir, 'bank_keys.json')
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(out_dir, 'consensus_verdict.json')
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None

    bank = json.load(open(keys_path))
    if limit:
        bank = bank[:limit]
    print(f"consensus: judging {len(bank)} puzzles on the NORMAL net (p1 top-1 + p2 all-7)", flush=True)

    t0 = time.time()
    model = kr.load_model(os.path.join(kr.BT_MODELS, 'model-v1.0.0-normal.pth'))
    verdicts = []
    for i, pz in enumerate(bank):
        v = verdict_for(model, pz)
        verdicts.append(v)
        tag = 'KEEP' if v['keep'] else f"DROP/{v['reason']}"
        p2_tag = f" p2={v['p2_agree']}/{v['p2_of']}" if v['p2_of'] is not None else ''
        print(f"  {i+1}/{len(bank)} #{v['number']} {tag} rank={v['rank']}{p2_tag}", flush=True)

    json.dump(verdicts, open(out_path, 'w'))

    kept = sum(1 for v in verdicts if v['keep'])
    disagree = sum(1 for v in verdicts if v['reason'] == 'disagree')
    disagree_p2 = sum(1 for v in verdicts if v['reason'] == 'disagree-p2')
    unreachable = sum(1 for v in verdicts if v['reason'] == 'unreachable')
    bt_error = sum(1 for v in verdicts if v['reason'] == 'bt-error')
    other = len(verdicts) - kept - disagree - disagree_p2 - unreachable - bt_error
    n = len(verdicts)
    pct = lambda k: f"{k}/{n} ({100*k/n:.0f}%)" if n else f"{k}/0"
    print(f"\n==== CONSENSUS [normal, p1 top-1 + p2 all-7] n={n} ====")
    print(f"   KEEP (p1 top-1 + p2 {P2_THRESHOLD}/7):           {pct(kept)}")
    print(f"   DROP / disagree-p1 (reachable, rank>1):  {pct(disagree)}")
    print(f"   DROP / disagree-p2 (p1 ok, p2 <{P2_THRESHOLD}/7): {pct(disagree_p2)}")
    print(f"   DROP / unreachable:                      {pct(unreachable)}")
    print(f"   DROP / bt-error (counted separately):    {pct(bt_error)}")
    print(f"   DROP / other (odd-parity, inject):       {pct(other)}")
    # p2 agreement distribution for puzzles that passed p1
    p2_counts = [v.get('p2_agree') for v in verdicts if v.get('p2_of') is not None]
    if p2_counts:
        for t in range(8):
            c = sum(1 for x in p2_counts if x == t)
            if c:
                print(f"   p2 agree={t}/7: {c}")
    print(f"   wrote {out_path}; elapsed {int(time.time()-t0)}s", flush=True)


if __name__ == "__main__":
    main()
