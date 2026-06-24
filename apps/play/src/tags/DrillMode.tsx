/**
 * Drill mode (#85): pick one or more puzzle types, then practise puzzles
 * carrying ANY selected type (OR) — **unrated practice** that never moves the
 * rating and writes no attempt row. A clear affordance marks it as practice and
 * lets the player change types; the main nav returns to rated play.
 */

import { useState, type ReactNode } from 'react';
import type { PuzzleTag } from '@trainer/core';
import { TAG_VOCAB } from './tagVocab.js';
import { PuzzlePlay, type PlayDb } from '../session/index.js';
import { type KeyBindings } from '../board/keybindings.js';

/** Every tag, in the shared vocabulary's declared order (the picker order). */
const ALL_TAGS = Object.keys(TAG_VOCAB) as PuzzleTag[];

export interface DrillModeProps {
  db: PlayDb;
  userId: string;
  leftFlank?: ReactNode;
  bindings?: KeyBindings;
  muted?: boolean;
}

export function DrillMode({ db, userId, leftFlank, bindings, muted }: DrillModeProps) {
  const [selected, setSelected] = useState<Set<PuzzleTag>>(new Set());
  // The tag set currently being drilled (null = still on the picker).
  const [active, setActive] = useState<PuzzleTag[] | null>(null);

  const toggle = (tag: PuzzleTag) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  if (active) {
    return (
      <div data-testid="drill-play">
        <div className="drill-bar">
          <span className="drill-tag-note">Drill — unrated practice</span>
          <button type="button" onClick={() => setActive(null)}>
            Change types
          </button>
        </div>
        <PuzzlePlay
          db={db}
          userId={userId}
          drillTags={active}
          leftFlank={leftFlank}
          bindings={bindings}
          muted={muted}
        />
      </div>
    );
  }

  return (
    <div data-testid="drill-picker" className="drill-picker">
      <p>
        Pick one or more types to drill. Drill is <strong>unrated practice</strong> — it won&apos;t
        change your rating.
      </p>
      <ul className="tag-chips drill-chips" aria-label="drill types">
        {ALL_TAGS.map((tag) => {
          const on = selected.has(tag);
          const { label, kind } = TAG_VOCAB[tag];
          return (
            <li key={tag}>
              <button
                type="button"
                className={`tag-chip tag-${kind}${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                data-tag={tag}
                onClick={() => toggle(tag)}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="drill-start"
        disabled={selected.size === 0}
        onClick={() => setActive([...selected])}
      >
        Start drilling
      </button>
    </div>
  );
}
