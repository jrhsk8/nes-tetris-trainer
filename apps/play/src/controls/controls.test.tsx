// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Controls } from './Controls.js';
import { DEFAULT_BINDINGS } from '../board/keybindings.js';

afterEach(() => cleanup());

const noMute = { muted: false, onMutedChange: () => {} };

describe('Controls panel', () => {
  it('shows the current key for each action', () => {
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={vi.fn()} {...noMute} />);
    // rotate-cw defaults to x.
    expect(screen.getByLabelText('Rebind Rotate clockwise')).toHaveTextContent('X');
    expect(screen.getByLabelText('Rebind Move left')).toHaveTextContent('←');
  });

  it('rebinds an action to a freshly pressed key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={onChange} {...noMute} />);

    await user.click(screen.getByLabelText('Rebind Rotate clockwise'));
    expect(screen.getByLabelText('Rebind Rotate clockwise')).toHaveTextContent('Press a key…');

    await user.keyboard('k');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]['rotate-cw']).toBe('k');
  });

  it('toggles the result sound, defaulting to on (#61)', async () => {
    const user = userEvent.setup();
    const onMutedChange = vi.fn();
    render(
      <Controls bindings={DEFAULT_BINDINGS} onChange={vi.fn()} muted={false} onMutedChange={onMutedChange} />,
    );
    const toggle = screen.getByTestId('control-sound').querySelector('input')!;
    expect(toggle).toBeChecked(); // sound on by default
    await user.click(toggle);
    expect(onMutedChange).toHaveBeenCalledWith(true); // unchecking mutes
  });

  it('warns on a conflict and does not apply it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={onChange} {...noMute} />);

    await user.click(screen.getByLabelText('Rebind Move left'));
    // z is already rotate-ccw — a conflict.
    await user.keyboard('z');

    expect(screen.getByTestId('controls-conflict')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    // Still listening: a free key now binds cleanly.
    await user.keyboard('q');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]['move-left']).toBe('q');
  });
});
