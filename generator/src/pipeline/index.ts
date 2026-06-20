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
export { toPlacement, gridsEqual } from './placement.js';
