// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Controls } from './Controls.js';
import { DEFAULT_BINDINGS } from '../board/keybindings.js';

afterEach(() => cleanup());

describe('Controls panel', () => {
  it('shows the current key for each action', () => {
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={vi.fn()} />);
    // rotate-cw defaults to x.
    expect(screen.getByLabelText('Rebind Rotate clockwise')).toHaveTextContent('X');
    expect(screen.getByLabelText('Rebind Move left')).toHaveTextContent('←');
  });

  it('rebinds an action to a freshly pressed key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={onChange} />);

    await user.click(screen.getByLabelText('Rebind Rotate clockwise'));
    expect(screen.getByLabelText('Rebind Rotate clockwise')).toHaveTextContent('Press a key…');

    await user.keyboard('k');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]['rotate-cw']).toBe('k');
  });

  it('warns on a conflict and does not apply it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controls bindings={DEFAULT_BINDINGS} onChange={onChange} />);

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
