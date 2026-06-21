/**
 * Generation pipeline (#9): candidate -> gates -> stored puzzle.
 */

export { assemblePuzzle, generateBank, DEFAULT_GENERATION_CONFIG } from './generate.js';
export type {
  GeneratorEngine,
  GenerationConfig,
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
export { difficultyFromScores, seedRatingFor, EASY_SEED, HARD_SEED, type Difficulty } from './difficulty.js';
export { boardHamming, isNearDuplicate, type BankKey } from './dedup.js';
export { tallyBankRatings, type TallyDeps, type TallyResult } from './tally.js';
