// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TagChips } from './TagChips.js';
import { TAG_VOCAB } from './tagVocab.js';

afterEach(() => cleanup());

describe('TagChips (#84)', () => {
  it('renders a readable chip per tag, using the shared vocabulary labels', () => {
    render(<TagChips tags={['tetris-ready', 'tuck', 'avoid-s-dependency']} />);
    const chips = screen.getByTestId('tag-chips');
    expect(chips).toBeInTheDocument();
    // Labels come from the one source of truth (TAG_VOCAB).
    expect(chips).toHaveTextContent(TAG_VOCAB['tetris-ready'].label);
    expect(chips).toHaveTextContent(TAG_VOCAB['tuck'].label);
    expect(chips).toHaveTextContent(TAG_VOCAB['avoid-s-dependency'].label);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('colour-codes a chip by its tag kind', () => {
    render(<TagChips tags={['tuck']} />);
    const chip = screen.getByText(TAG_VOCAB['tuck'].label);
    expect(chip).toHaveClass('tag-chip', `tag-${TAG_VOCAB['tuck'].kind}`);
  });

  it('renders nothing for an untagged puzzle', () => {
    render(<TagChips tags={[]} />);
    expect(screen.queryByTestId('tag-chips')).not.toBeInTheDocument();
  });
});
