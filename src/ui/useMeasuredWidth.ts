/**
 * Measure the width a view is actually drawn at.
 *
 * The views make claims in pixels — "below a pixel here", "N px per red blood
 * cell", "10 px minimum marker spacing". A fixed `viewBox` scaled by CSS makes
 * every one of those false on any screen that is not the nominal width: on a
 * 420 px phone a 960-unit viewBox reports 5.76 px for something drawn at 1.88.
 *
 * Measuring the element makes one viewBox unit one CSS pixel again, so the
 * numbers on screen describe the screen.
 */

import { useCallback, useState } from 'react';

/**
 * A tuple rather than an object, and a callback ref rather than a ref object.
 * The width is read during render, so it has to come from state — and the React
 * compiler will not let a width that shares an object with a ref reach render,
 * which is the right rule to be held to.
 */
export type MeasuredWidth = readonly [
  width: number,
  attach: (element: HTMLElement | null) => void | (() => void),
];

export function useMeasuredWidth(fallbackWidth: number): MeasuredWidth {
  const [width, setWidth] = useState(fallbackWidth);

  const attach = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;

    // ResizeObserver fires once on observe, so the first real measurement
    // arrives from the callback rather than from the attach.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const next = Math.max(1, Math.round(entry.contentRect.width));
      setWidth((current) => (current === next ? current : next));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [width, attach];
}
