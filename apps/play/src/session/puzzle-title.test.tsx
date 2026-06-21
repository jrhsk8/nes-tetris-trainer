// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PuzzleTitle } from './PuzzleTitle.js';

afterEach(() => cleanup());

describe('PuzzleTitle (#49)', () => {
  it('shows "Puzzle #N" as the title', () => {
    render(<PuzzleTitle number={123} />);
    expect(screen.getByTestId('puzzle-title')).toHaveTextContent('Puzzle #123');
  });

  it('renders nothing for a legacy puzzle with no number', () => {
    render(<PuzzleTitle number={null} />);
    expect(screen.queryByTestId('puzzle-title')).not.toBeInTheDocument();
  });

  it('copies a shareable ?puzzle=N link when the share control is used', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PuzzleTitle number={42} />);

    await userEvent.click(screen.getByRole('button', { name: /copy a shareable link/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('?puzzle=42');
    expect(await screen.findByRole('button', { name: /copy a shareable link/i })).toHaveTextContent(
      'Copied!',
    );
  });
});
