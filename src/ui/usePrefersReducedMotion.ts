/**
 * Whether the person using the app has asked for reduced motion.
 *
 * The rule this project follows: reduced motion removes *autonomous* motion —
 * nothing plays itself — while everything remains reachable by hand. A scrubber
 * is not motion; a timer driving the scrubber is.
 *
 * Live, not read-once: the setting can change while the page is open, and a
 * stale answer would keep an animation running for someone who just asked for
 * none.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function read(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read);
}
