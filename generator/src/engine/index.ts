/**
 * Offline StackRabbit engine client (#4). Re-exported for the generator
 * pipeline (self-play #8, quality filters #7, the assembly CLI #9).
 */

export {
  StackRabbitClient,
  parseMoveResponse,
  parseRateResponse,
  SPAWN_COLUMN,
  DEFAULT_BASE_URL,
} from './client.js';
export type {
  MoveQuery,
  EngineMove,
  RateMoveResult,
  StackRabbitClientOptions,
  ParsedMove,
} from './client.js';
