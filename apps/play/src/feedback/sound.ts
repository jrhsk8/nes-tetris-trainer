/**
 * NES-style result chiptune (#61, grill #5).
 *
 * On a graded result the play loop plays a short Web Audio jingle: an ascending
 * square-wave arpeggio for an A+ win, a single soft blip for anything below.
 * Synthesised inline (no asset files) so it stays tiny and offline. A mute
 * toggle in Controls (persisted in prefs) gates it upstream — this module just
 * makes the sound.
 *
 * Safe everywhere: if the Web Audio API is unavailable (SSR, jsdom tests, an old
 * browser) it is a silent no-op rather than a throw.
 */

/** The `AudioContext` constructor, or `null` when Web Audio is unavailable. */
function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** One scheduled tone on a shared context. */
function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  peak: number,
  type: OscillatorType,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // A quick attack + exponential decay reads as a crisp chip blip.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// An A+ win: a bright ascending arpeggio (C5–E5–G5–C6). Below: one soft G4 blip.
const WIN_ARPEGGIO = [523.25, 659.25, 783.99, 1046.5];
const BELOW_BLIP = [392.0];

/**
 * Play the result jingle: an ascending arpeggio for an A+ `win`, a soft neutral
 * blip otherwise. No-op when Web Audio is unavailable.
 */
export function playResultSound(win: boolean): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return; // context construction blocked (e.g. autoplay policy) — stay silent.
  }
  const now = ctx.currentTime;
  const notes = win ? WIN_ARPEGGIO : BELOW_BLIP;
  const step = win ? 0.09 : 0.18;
  const peak = win ? 0.2 : 0.12;
  const type: OscillatorType = win ? 'square' : 'triangle';
  notes.forEach((freq, i) => tone(ctx, freq, now + i * step, step, peak, type));

  // Free the context once the jingle has finished playing.
  const lifetimeMs = (notes.length * step + 0.2) * 1000;
  setTimeout(() => void ctx.close().catch(() => {}), lifetimeMs);
}
