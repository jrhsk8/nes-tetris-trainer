/**
 * Generation pipeline (#9): candidate -> gates -> stored puzzle.
 */

export { assemblePuzzle, classifyLane, generateBank, DEFAULT_GENERATION_CONFIG } from './generate.js';
export type {
  GeneratorEngine,
  GenerationConfig,
  VarietyLane,
  BoardLane,
  AssemblyResult,
  GenerateBankDeps,
  GenerateBankOptions,
  BankResult,
} from './generate.js';
export {
  sweepCombos,
  normalizeCombos,
  normalizedScores,
  boardHealth,
  isReachablePlacement,
  type ComboContext,
  type ComboEngine,
  type ScoredCombo,
} from './combo.js';
export {
  difficultyFromScores,
  seedRatingFor,
  bandFor,
  VERY_EASY_SEED,
  EASY_SEED,
  HARD_SEED,
  HARD_MAX_ACCEPTS,
  EASY_MIN_ACCEPTS,
  VERY_EASY_MIN_ACCEPTS,
  DIFFICULTY_BANDS,
  lineClearsTetris,
  entryClearsTetris,
  restingLineForEntry,
  clearsTetrisFromEntries,
  rebandPuzzle,
  type Difficulty,
  type DifficultyOptions,
  type DifficultyBand,
  type Reband,
} from './difficulty.js';
export { boardHamming, isNearDuplicate, type BankKey } from './dedup.js';
export { tallyBankRatings, type TallyDeps, type TallyResult } from './tally.js';
export {
  consensusKeys,
  filterByConsensus,
  betaTetrisJudge,
  type ConsensusPuzzle,
  type ConsensusKeyRow,
  type ConsensusJudge,
  type ConsensusVerdict,
  type ConsensusReason,
  type ConsensusResult,
} from './consensus.js';
