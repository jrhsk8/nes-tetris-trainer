/**
 * StackRabbit engine client (#4) — a thin, typed wrapper over the local
 * StackRabbit HTTP server. Used ONLY by the offline generator; the play app
 * never imports this module (see docs/PRD-v1.md, "Architecture" and CLAUDE.md).
 *
 * It hides three things behind a typed interface: the URL/query-string
 * building, the 200-char board encoding (reusing the board model from #3), and
 * StackRabbit's response formats. The board orientation is the confirmed
 * `decodeBoard`/`encodeBoard` orientation (row 0 = top), which matches
 * StackRabbit's `parseBoard`.
 */

import { decodeBoard, encodeBoard, type Grid, type Piece } from '@trainer/core';

/** StackRabbit's spawn column (`INITIAL_X`): reported x-offsets are relative to it. */
export const SPAWN_COLUMN = 3;

/** Default base URL of the locally-running StackRabbit server. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

/** The board state and piece context for a move query. */
export interface MoveQuery {
  /** The current board. */
  board: Grid;
  /** The piece to place now. */
  currentPiece: Piece;
  /** The piece visible after the current one, or `null` for no-lookahead. */
  nextPiece: Piece | null;
  /** NES level (>= 18; StackRabbit supports 18/19/29 starts). */
  level: number;
  /** Lines cleared so far in the game. */
  lines: number;
  /** Input-frame timeline, e.g. `'X.....'` (slow tap) or `'X.'` (fast DAS). */
  inputFrameTimeline: string;
}

/** A placement the engine returned, in StackRabbit's native coordinates. */
export interface EngineMove {
  /** Rotation index (StackRabbit's numbering). */
  rotation: number;
  /** Horizontal offset of the piece origin from the spawn column (`SPAWN_COLUMN`). */
  x: number;
  /** Vertical offset of the piece origin from its spawn row. */
  y: number;
  /** The board after the current piece locks and any full rows clear. */
  board: Grid;
  /** Engine valuation of this move (higher is better); `NaN` if unavailable. */
  totalValue: number;
}

/** The valuations from scoring a specific placement against the engine's best. */
export interface RateMoveResult {
  /** Value of the supplied (player) move. */
  playerValue: number;
  /** Value of the engine's best move from the same position. */
  bestValue: number;
}

/** Options for constructing a {@link StackRabbitClient}. */
export interface StackRabbitClientOptions {
  /** Base URL of the engine; defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Injectable `fetch` (for tests); defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Playout count for value queries. `0` (the default) uses StackRabbit's
   * fast, deterministic eval-only scoring — enough for relative move ranking
   * and free of the playout path's instability on degenerate boards.
   */
  playoutCount?: number;
  /** Playout length for value queries (only used when `playoutCount > 0`). */
  playoutLength?: number;
}

/** Parsed fields of a `get-move-cpp` response (`rot,x,y|inputs|board|level|lines`). */
export interface ParsedMove {
  rotation: number;
  x: number;
  y: number;
  board: Grid;
}

/**
 * Parse a `get-move-cpp` / `get-move-async-cpp` response line. Returns `null`
 * for the engine's "No legal moves" sentinel. Throws if the shape is otherwise
 * unrecognisable, so a malformed response is never silently treated as a move.
 */
export function parseMoveResponse(body: string): ParsedMove | null {
  const trimmed = body.trim();
  if (trimmed === '' || trimmed.startsWith('No legal moves')) return null;

  const parts = trimmed.split('|');
  if (parts.length < 3) {
    throw new Error(`unexpected get-move response: ${trimmed.slice(0, 80)}`);
  }
  const placement = parts[0].split(',');
  if (placement.length !== 3) {
    throw new Error(`unexpected placement field: ${parts[0]}`);
  }
  const [rotation, x, y] = placement.map((n) => Number.parseInt(n, 10));
  if ([rotation, x, y].some(Number.isNaN)) {
    throw new Error(`non-numeric placement: ${parts[0]}`);
  }
  // Field 2 is the input sequence; field 3 is the 200-char resulting board.
  return { rotation, x, y, board: decodeBoard(parts[2]) };
}

/** The JSON shape StackRabbit's `rate-move-cpp` returns. */
interface RateMoveJson {
  playerMoveNoAdjustment: number;
  bestMoveNoAdjustment: number;
  playerMoveAfterAdjustment?: number;
  bestMoveAfterAdjustment?: number;
}

/**
 * Parse a `rate-move-cpp` JSON response. When a next piece was supplied the
 * "after adjustment" figures are the meaningful ones (they account for the
 * lookahead); otherwise the "no adjustment" figures are used.
 */
export function parseRateResponse(body: string): RateMoveResult {
  const trimmed = body.trim();
  if (trimmed.startsWith('Error')) {
    throw new Error(`rate-move failed: ${trimmed}`);
  }
  const json = JSON.parse(trimmed) as RateMoveJson;
  const hasAdjustment =
    json.playerMoveAfterAdjustment !== undefined && json.bestMoveAfterAdjustment !== undefined;
  return {
    playerValue: hasAdjustment ? json.playerMoveAfterAdjustment! : json.playerMoveNoAdjustment,
    bestValue: hasAdjustment ? json.bestMoveAfterAdjustment! : json.bestMoveNoAdjustment,
  };
}

/**
 * Build the query string shared by the move endpoints. `secondBoard` is the
 * post-move board, required only by `rate-move-cpp`.
 */
function buildQuery(
  query: MoveQuery,
  playoutCount: number,
  playoutLength: number,
  secondBoard?: Grid,
): string {
  const params = new URLSearchParams({
    board: encodeBoard(query.board),
    currentPiece: query.currentPiece,
    level: String(query.level),
    lines: String(query.lines),
    inputFrameTimeline: query.inputFrameTimeline,
    playoutCount: String(playoutCount),
    playoutLength: String(playoutLength),
  });
  if (query.nextPiece) params.set('nextPiece', query.nextPiece);
  if (secondBoard) params.set('secondBoard', encodeBoard(secondBoard));
  return params.toString();
}

/**
 * Typed client over the local StackRabbit server. Offline use only.
 */
export class StackRabbitClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly playoutCount: number;
  private readonly playoutLength: number;

  constructor(options: StackRabbitClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.playoutCount = options.playoutCount ?? 0;
    this.playoutLength = options.playoutLength ?? 2;
  }

  /** GET a path and return the response body as text, throwing on non-2xx. */
  private async get(path: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/${path}`);
    if (!res.ok) {
      throw new Error(`engine ${path.split('?')[0]} returned HTTP ${res.status}`);
    }
    return res.text();
  }

  /** True if the engine answers its health check. Never throws. */
  async ping(): Promise<boolean> {
    try {
      const body = await this.get('ping');
      return body.trim() === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * The engine's best placement for the current piece (considering the next
   * piece, if any). Returns `null` if the engine reports no legal moves. The
   * returned board is the board AFTER the current piece locks — the input for
   * the next ply when building a two-ply line.
   */
  async getBestMove(query: MoveQuery): Promise<EngineMove | null> {
    const body = await this.get(
      `get-move-cpp?${buildQuery(query, this.playoutCount, this.playoutLength)}`,
    );
    const move = parseMoveResponse(body);
    if (!move) return null;

    // get-move-cpp does not report a value; score the chosen board to fill it.
    let totalValue = Number.NaN;
    try {
      totalValue = (await this.rateMove(query, move.board)).playerValue;
    } catch {
      // Leave totalValue as NaN if scoring is unavailable; the placement stands.
    }
    return { ...move, totalValue };
  }

  /**
   * Score a specific placement: supply the board AFTER the player's move and
   * get back its value alongside the engine's best value from the same start.
   */
  async rateMove(query: MoveQuery, playerBoardAfter: Grid): Promise<RateMoveResult> {
    const body = await this.get(
      `rate-move-cpp?${buildQuery(query, this.playoutCount, this.playoutLength, playerBoardAfter)}`,
    );
    return parseRateResponse(body);
  }
}
