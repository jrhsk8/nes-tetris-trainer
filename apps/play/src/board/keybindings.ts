/**
 * Key bindings (#24) — the pure model behind rebindable placement controls.
 *
 * Five actions are rebindable: move left/right, rotate clockwise/counter-
 * clockwise, and confirm. Each maps to one primary key. Two fixed secondary
 * aliases ship out of the box — Space confirms and ArrowUp is a rotate-CW alias
 * (NES "up = rotate") — and apply only when that key is not a primary binding.
 *
 * No DOM here: {@link PlacementInput} resolves keydown events through
 * `resolveAction`, and the Controls panel edits bindings with `findConflict` /
 * `rebind`. Bindings persist per user (Supabase `user_prefs`) so they sync
 * across devices like the rating.
 */

/** A rebindable placement action. */
export type Action = 'move-left' | 'move-right' | 'rotate-cw' | 'rotate-ccw' | 'confirm';

/** The actions in display order, with human labels for the Controls panel. */
export const ACTIONS: ReadonlyArray<{ action: Action; label: string }> = [
  { action: 'move-left', label: 'Move left' },
  { action: 'move-right', label: 'Move right' },
  { action: 'rotate-ccw', label: 'Rotate counter-clockwise' },
  { action: 'rotate-cw', label: 'Rotate clockwise' },
  { action: 'confirm', label: 'Confirm placement' },
];

/** A primary key per action (the value is a normalized `KeyboardEvent.key`). */
export type KeyBindings = Record<Action, string>;

/** The out-of-the-box bindings: arrows move, z/x rotate CCW/CW, Enter confirms. */
export const DEFAULT_BINDINGS: KeyBindings = {
  'move-left': 'ArrowLeft',
  'move-right': 'ArrowRight',
  'rotate-ccw': 'z',
  'rotate-cw': 'x',
  confirm: 'Enter',
};

/** Fixed secondary aliases; active only when the key isn't a primary binding. */
const ALIASES: Readonly<Record<string, Action>> = {
  ' ': 'confirm',
  ArrowUp: 'rotate-cw',
};

/**
 * Normalize a `KeyboardEvent.key` for matching/storage: single characters
 * (letters, space, digits) fold to lower case so Shift doesn't change the
 * binding; named keys (ArrowLeft, Enter…) are kept verbatim.
 */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** The action a key triggers under `bindings`, or null if it is unbound. */
export function resolveAction(bindings: KeyBindings, key: string): Action | null {
  const k = normalizeKey(key);
  const direct = (Object.keys(bindings) as Action[]).find(
    (action) => normalizeKey(bindings[action]) === k,
  );
  if (direct) return direct;
  return ALIASES[k] ?? null;
}

/**
 * The OTHER action already bound to `key`, or null. Used to surface a conflict
 * before applying a rebind (no silent double-binding).
 */
export function findConflict(bindings: KeyBindings, action: Action, key: string): Action | null {
  const k = normalizeKey(key);
  const owner = (Object.keys(bindings) as Action[]).find(
    (a) => a !== action && normalizeKey(bindings[a]) === k,
  );
  return owner ?? null;
}

/** A copy of `bindings` with `action` bound to `key`. */
export function rebind(bindings: KeyBindings, action: Action, key: string): KeyBindings {
  return { ...bindings, [action]: normalizeKey(key) };
}

/**
 * Merge a stored (possibly partial or unknown) bindings object over the
 * defaults, keeping only known actions with non-empty string keys. Used when
 * loading prefs so a missing/extra field can never break input.
 */
export function sanitizeBindings(raw: unknown): KeyBindings {
  const merged: KeyBindings = { ...DEFAULT_BINDINGS };
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const { action } of ACTIONS) {
      const value = record[action];
      if (typeof value === 'string' && value.length > 0) merged[action] = normalizeKey(value);
    }
  }
  return merged;
}

/** A readable label for a bound key (for the Controls panel). */
export function keyLabel(key: string): string {
  switch (key) {
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case ' ':
      return 'Space';
    case 'Enter':
      return 'Enter';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}
