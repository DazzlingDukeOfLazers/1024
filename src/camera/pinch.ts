/**
 * Two-finger gesture arithmetic, in one dimension.
 *
 * Both pannable views are horizontal, so a pinch reduces to two numbers: how
 * far apart the fingers are, and where their midpoint sits. Keeping that here
 * rather than in each view means it can be tested without a browser and cannot
 * drift between the ruler and the atlas.
 *
 * This exists because `touch-action: none` on those views takes the browser's
 * own pinch away. That is the right call — the app owns the gesture — but only
 * if the app then implements it. Without this there is no way to zoom on a
 * phone: the wheel is not there and neither is the keyboard.
 */

export interface Pinch {
  /** Distance between the two touches, in element pixels. Never zero. */
  readonly spread: number;
  /** Midpoint between them, in element pixels. */
  readonly center: number;
}

/** The pinch two active touches describe, or `undefined` if there are not two. */
export function pinchOf(positions: readonly number[]): Pinch | undefined {
  if (positions.length !== 2) return undefined;
  const [a, b] = positions as [number, number];
  // A zero spread would make every later ratio infinite. One pixel is finer
  // than a finger can place itself, so clamping there is both safe and never
  // reached by a real gesture.
  return { spread: Math.max(Math.abs(b - a), 1), center: (a + b) / 2 };
}

/**
 * How far the view should scale between two samples of one gesture. Greater
 * than 1 when the fingers moved apart, which means zooming in.
 */
export function pinchScale(previous: Pinch, current: Pinch): number {
  return current.spread / previous.spread;
}

/**
 * The change in a log10 scale — metres per pixel — that a pinch calls for.
 * Spreading the fingers shows a smaller span, so the figure is negative.
 */
export function pinchLog10Delta(previous: Pinch, current: Pinch): number {
  return -Math.log10(pinchScale(previous, current));
}
