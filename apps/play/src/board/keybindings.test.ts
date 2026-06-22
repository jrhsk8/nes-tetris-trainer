import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BINDINGS,
  findConflict,
  rebind,
  resolveAction,
  sanitizeBindings,
} from './keybindings.js';

describe('key bindings', () => {
  it('resolves the default keys out of the box', () => {
    expect(resolveAction(DEFAULT_BINDINGS, 'ArrowLeft')).toBe('move-left');
    expect(resolveAction(DEFAULT_BINDINGS, 'ArrowRight')).toBe('move-right');
    expect(resolveAction(DEFAULT_BINDINGS, 'z')).toBe('rotate-ccw');
    expect(resolveAction(DEFAULT_BINDINGS, 'x')).toBe('rotate-cw');
    expect(resolveAction(DEFAULT_BINDINGS, 'Enter')).toBe('confirm');
  });

  it('honors the fixed aliases: Space confirms, ArrowUp raises (#56)', () => {
    expect(resolveAction(DEFAULT_BINDINGS, ' ')).toBe('confirm');
    // ArrowUp is the "move up" alias (the inverse of ArrowDown soft-drop), so a
    // soft-drop overshoot can be undone to seat a tuck/spin. Rotate stays on z/x.
    expect(resolveAction(DEFAULT_BINDINGS, 'ArrowUp')).toBe('move-up');
  });

  it('ignores Shift by folding single keys to lower case', () => {
    expect(resolveAction(DEFAULT_BINDINGS, 'Z')).toBe('rotate-ccw');
    expect(resolveAction(DEFAULT_BINDINGS, 'X')).toBe('rotate-cw');
  });

  it('returns null for an unbound key', () => {
    expect(resolveAction(DEFAULT_BINDINGS, 'q')).toBeNull();
  });

  it('applies a rebind and resolves the new key', () => {
    const next = rebind(DEFAULT_BINDINGS, 'rotate-cw', 'k');
    expect(next['rotate-cw']).toBe('k');
    expect(resolveAction(next, 'k')).toBe('rotate-cw');
  });

  it('surfaces a conflict when a key is already bound to another action', () => {
    // x is rotate-cw by default; binding it to move-left would clash.
    expect(findConflict(DEFAULT_BINDINGS, 'move-left', 'x')).toBe('rotate-cw');
    // Rebinding an action to its own current key is not a conflict.
    expect(findConflict(DEFAULT_BINDINGS, 'rotate-cw', 'x')).toBeNull();
    // A free key has no conflict.
    expect(findConflict(DEFAULT_BINDINGS, 'move-left', 'k')).toBeNull();
  });

  it('sanitizes stored prefs by merging over defaults', () => {
    expect(sanitizeBindings({ 'rotate-cw': 'k' })['rotate-cw']).toBe('k');
    // Unknown/missing fields fall back to defaults.
    const merged = sanitizeBindings({ bogus: 'q' });
    expect(merged).toEqual(DEFAULT_BINDINGS);
    // A non-object is fully defaulted.
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
  });
});
