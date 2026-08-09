/**
 * Keyboard navigation for the pannable, zoomable views.
 *
 * Both lenses were pointer-only, which axe cannot flag — a `role="img"` SVG is
 * not expected to be interactive, so nothing was technically wrong. It was just
 * unusable without a mouse.
 *
 * The mapping is shared so the Ruler and the Atlas cannot drift apart, and it
 * is pure so it can be tested without a browser.
 */

export type ViewCommand =
  | { readonly kind: 'pan'; readonly pixels: number }
  | { readonly kind: 'zoom'; readonly steps: number }
  | { readonly kind: 'reset' };

export interface KeyboardOptions {
  /** Pixels moved by one arrow press. */
  readonly panStep?: number;
  /** Multiplier applied when a modifier is held. */
  readonly coarseFactor?: number;
}

const DEFAULTS = { panStep: 40, coarseFactor: 5 } as const;

/**
 * Translate a key press into a view command, or `undefined` to let the browser
 * have it. Returning `undefined` matters: swallowing Tab would trap focus.
 */
export function commandForKey(
  key: string,
  modifiers: { shiftKey?: boolean } = {},
  options: KeyboardOptions = {},
): ViewCommand | undefined {
  const panStep = options.panStep ?? DEFAULTS.panStep;
  const coarse = modifiers.shiftKey === true ? (options.coarseFactor ?? DEFAULTS.coarseFactor) : 1;

  switch (key) {
    case 'ArrowLeft':
      return { kind: 'pan', pixels: panStep * coarse };
    case 'ArrowRight':
      return { kind: 'pan', pixels: -panStep * coarse };
    case 'PageUp':
      return { kind: 'pan', pixels: panStep * 10 };
    case 'PageDown':
      return { kind: 'pan', pixels: -panStep * 10 };
    case 'ArrowUp':
    case '+':
    case '=':
      return { kind: 'zoom', steps: coarse };
    case 'ArrowDown':
    case '-':
    case '_':
      return { kind: 'zoom', steps: -coarse };
    case 'Home':
      return { kind: 'reset' };
    default:
      return undefined;
  }
}

/** Spoken to screen readers and shown under each view. */
export const KEYBOARD_HINT =
  'Arrow keys pan and zoom, plus and minus zoom, Page Up and Page Down pan further, Home resets. Hold Shift to move faster.';
