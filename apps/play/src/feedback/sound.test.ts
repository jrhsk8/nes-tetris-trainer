// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { playResultSound } from './sound.js';

/** A minimal fake Web Audio graph that records how many oscillators were made. */
function fakeAudio() {
  const oscillators: Array<{ type: string; freq: number }> = [];
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createOscillator() {
      const node = {
        type: 'sine',
        frequency: { value: 0 },
        connect: () => ({ connect: () => {} }),
        start: () => {},
        stop: () => {},
      };
      oscillators.push({
        get type() {
          return node.type;
        },
        get freq() {
          return node.frequency.value;
        },
      } as { type: string; freq: number });
      return node;
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => ({ connect: () => {} }),
      };
    }
    close() {
      return Promise.resolve();
    }
  }
  return { FakeAudioContext, oscillators };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('playResultSound (#61)', () => {
  it('plays a multi-note ascending arpeggio for an A+ win', () => {
    const { FakeAudioContext, oscillators } = fakeAudio();
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    playResultSound(true);
    // The win jingle is several ascending square-wave notes.
    expect(oscillators.length).toBeGreaterThan(1);
    expect(oscillators.every((o) => o.type === 'square')).toBe(true);
    const freqs = oscillators.map((o) => o.freq);
    for (let i = 1; i < freqs.length; i++) expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
  });

  it('plays a single soft blip for a below-A+ result', () => {
    const { FakeAudioContext, oscillators } = fakeAudio();
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    playResultSound(false);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].type).toBe('triangle');
  });

  it('is a silent no-op when Web Audio is unavailable', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    expect(() => playResultSound(true)).not.toThrow();
  });
});
