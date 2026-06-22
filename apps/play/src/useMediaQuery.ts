/**
 * useMediaQuery (#70) — subscribe to a CSS media query and re-render when it
 * flips. Used to switch the feedback rail into its compact, zero-scroll mobile
 * form (a "more" expand for deeper ranks) without duplicating layout in JS.
 *
 * Guarded for environments without `matchMedia` (jsdom unit tests, SSR): there
 * it always reports `false`, so components render their full desktop form and
 * existing tests are unaffected.
 */

import { useEffect, useState } from 'react';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    hasMatchMedia() ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
