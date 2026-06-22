import { describe, it, expect } from 'vitest';
import { emptyBoard, encodeBoard, type Grid } from '@trainer/core';
import {
  StackRabbitClient,
  parseMoveResponse,
  parseRateResponse,
  DEFAULT_BASE_URL,
} from './client.js';

// A realistic mid-game board: bottom four rows filled in the left six columns
// only. Non-degenerate (so the engine's search paths stay well-defined) yet no
// single tetromino can complete a 10-wide row, so a placement always adds
// exactly four cells with no line clear — which lets the orientation check
// below assert on cell counts.
function midGameBoard(): Grid {
  const board = emptyBoard();
  for (let row = 16; row < 20; row++) {
    for (let col = 0; col < 6; col++) board[row][col] = 1;
  }
  return board;
}

describe('parseMoveResponse', () => {
  it('parses a get-move-cpp response into placement + resulting board', () => {
    const board = encodeBoard(midGameBoard());
    const move = parseMoveResponse(`2,-1,18|X.....R...***|${board}|18|0`);
    expect(move).not.toBeNull();
    expect(move).toMatchObject({ rotation: 2, x: -1, y: 18 });
    expect(move!.board).toHaveLength(20);
    expect(move!.board[0]).toHaveLength(10);
  });

  it('returns null for the "No legal moves" sentinel', () => {
    expect(parseMoveResponse('No legal moves')).toBeNull();
    expect(parseMoveResponse('  ')).toBeNull();
  });

  it('throws on a malformed response', () => {
    expect(() => parseMoveResponse('garbage')).toThrow();
  });
});

describe('parseRateResponse', () => {
  it('prefers the after-adjustment figures when a next piece was supplied', () => {
    const result = parseRateResponse(
      '{"playerMoveNoAdjustment":-37.25, "bestMoveNoAdjustment":-30.00, ' +
        '"playerMoveAfterAdjustment":-1.5, "bestMoveAfterAdjustment":-0.28}',
    );
    expect(result).toEqual({ playerValue: -1.5, bestValue: -0.28 });
  });

  it('falls back to the no-adjustment figures with no next piece', () => {
    const result = parseRateResponse(
      '{"playerMoveNoAdjustment":-12.5, "bestMoveNoAdjustment":-10.0}',
    );
    expect(result).toEqual({ playerValue: -12.5, bestValue: -10.0 });
  });

  it('throws when the engine reports an error', () => {
    expect(() => parseRateResponse('Error: player move not found')).toThrow();
  });
});

describe('rateMove deeper-search plumbing (#53)', () => {
  const query = {
    board: midGameBoard(),
    currentPiece: 'T' as const,
    nextPiece: 'L' as const,
    level: 18,
    lines: 0,
    inputFrameTimeline: 'X.....',
  };
  const body = '{"playerMoveNoAdjustment":-1,"bestMoveNoAdjustment":0}';

  /** A fake `fetch` that records the requested URL and returns a canned rate body. */
  function recordingFetch() {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      urls.push(String(input));
      return { ok: true, text: async () => body } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, urls };
  }

  it('defaults to the client eval-only playoutCount', async () => {
    const { fetchImpl, urls } = recordingFetch();
    const client = new StackRabbitClient({ fetch: fetchImpl });
    await client.rateMove(query, midGameBoard());
    expect(new URL(urls[0]).searchParams.get('playoutCount')).toBe('0');
  });

  it('passes a per-call deeper playoutCount/playoutLength through to the query', async () => {
    const { fetchImpl, urls } = recordingFetch();
    const client = new StackRabbitClient({ fetch: fetchImpl });
    await client.rateMove(query, midGameBoard(), { playoutCount: 32, playoutLength: 3 });
    const params = new URL(urls[0]).searchParams;
    expect(params.get('playoutCount')).toBe('32');
    expect(params.get('playoutLength')).toBe('3');
  });
});

// Integration smoke test — exercises the real HTTP client against a live local
// StackRabbit (the engine client is I/O, so it is covered here rather than by
// mocked unit tests; see docs/PRD-v1.md "Testing Decisions"). Skipped cleanly
// when no engine is reachable (e.g. CI without the engine), so the build is
// green either way.
const baseUrl = process.env.STACKRABBIT_URL ?? DEFAULT_BASE_URL;
const engineUp = await new StackRabbitClient({ baseUrl }).ping();

describe.skipIf(!engineUp)('StackRabbitClient (live engine)', () => {
  const client = new StackRabbitClient({ baseUrl });

  it('reports the engine as healthy', async () => {
    expect(await client.ping()).toBe(true);
  });

  it('returns a valid best move that actually places the piece', async () => {
    const board = midGameBoard();
    const move = await client.getBestMove({
      board,
      currentPiece: 'T',
      nextPiece: 'L',
      level: 18,
      lines: 0,
      inputFrameTimeline: 'X.....',
    });

    expect(move).not.toBeNull();
    expect(move!.rotation).toBeGreaterThanOrEqual(0);
    expect(move!.board).toHaveLength(20);

    // The resulting board must have four more filled cells than the input
    // (one tetromino, no line clears on this board) — confirms the engine's
    // board orientation round-trips through encode/decode.
    const filled = (g: Grid) => g.flat().filter((c) => c).length;
    expect(filled(move!.board)).toBe(filled(board) + 4);
    expect(Number.isFinite(move!.totalValue)).toBe(true);
  });

  it('scores a placement, ranking the engine best at least as high as a player move', async () => {
    const board = midGameBoard();
    const query = {
      board,
      currentPiece: 'T' as const,
      nextPiece: 'L' as const,
      level: 18,
      lines: 0,
      inputFrameTimeline: 'X.....',
    };
    const best = await client.getBestMove(query);
    expect(best).not.toBeNull();

    const rated = await client.rateMove(query, best!.board);
    expect(rated.bestValue).toBeGreaterThanOrEqual(rated.playerValue - 1e-3);
  });
});
