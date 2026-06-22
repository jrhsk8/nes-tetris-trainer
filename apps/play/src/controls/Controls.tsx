/**
 * Controls panel (#24) — rebind the five placement actions. Click an action to
 * listen, then press a key to bind it. If that key already belongs to another
 * action the panel warns and keeps listening (no silent double-binding); Escape
 * cancels. A successful rebind is handed up via `onChange`, which the account
 * shell applies immediately and persists to Supabase so it syncs across devices.
 */

import { useEffect, useState } from 'react';
import {
  ACTIONS,
  findConflict,
  keyLabel,
  rebind,
  type KeyBindings,
  type RebindableAction,
} from '../board/keybindings.js';

export interface ControlsProps {
  bindings: KeyBindings;
  /** Called with the new bindings when an action is successfully rebound. */
  onChange: (bindings: KeyBindings) => void;
}

const LABELS: Record<RebindableAction, string> = Object.fromEntries(
  ACTIONS.map(({ action, label }) => [action, label]),
) as Record<RebindableAction, string>;

export function Controls({ bindings, onChange }: ControlsProps) {
  const [listening, setListening] = useState<RebindableAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === 'Escape') {
        setListening(null);
        setConflict(null);
        return;
      }
      const owner = findConflict(bindings, listening, event.key);
      if (owner) {
        setConflict(
          `"${keyLabel(event.key)}" is already bound to ${LABELS[owner]}. Press another key.`,
        );
        return;
      }
      onChange(rebind(bindings, listening, event.key));
      setListening(null);
      setConflict(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listening, bindings, onChange]);

  return (
    <section data-testid="view-controls" aria-label="controls">
      <h2>Controls</h2>
      <p className="controls-hint">Click an action, then press a key to bind it. Esc cancels.</p>
      {conflict ? (
        <p role="alert" className="controls-conflict" data-testid="controls-conflict">
          {conflict}
        </p>
      ) : null}
      <table className="controls-table">
        <tbody>
          {ACTIONS.map(({ action, label }) => {
            const isListening = listening === action;
            return (
              <tr key={action} data-testid={`control-${action}`}>
                <td>{label}</td>
                <td>
                  <button
                    type="button"
                    className={isListening ? 'control-listening' : undefined}
                    aria-label={`Rebind ${label}`}
                    aria-pressed={isListening}
                    onClick={() => {
                      setConflict(null);
                      setListening(isListening ? null : action);
                    }}
                  >
                    {isListening ? 'Press a key…' : keyLabel(bindings[action])}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
