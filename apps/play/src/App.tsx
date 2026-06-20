import { PIECES } from '@trainer/core';

/** Placeholder shell for the play app. The puzzle session UI lands in #10/#11. */
export function App() {
  return (
    <main>
      <h1>NES Tetris Stacking Trainer</h1>
      <p>Train stacking judgment — where to put each piece, independent of speed.</p>
      <p>Pieces: {PIECES.join(' ')}</p>
    </main>
  );
}
