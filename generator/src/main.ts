import { PIECES } from '@trainer/core';

/**
 * Offline generator entry point. The real pipeline (self-play → filters →
 * persist) lands in later issues (#8, #7, #9); for the scaffold this just
 * proves the generator workspace resolves @trainer/core and runs under tsx.
 */
function main(): void {
  console.log(`@trainer/generator ready — known pieces: ${PIECES.join(', ')}`);
}

main();
