/**
 * Keeping text labels from overlapping each other.
 *
 * The views already refuse to draw two markers closer than ten pixels. Their
 * labels had no such rule: the Atlas staggered them across rows using a fixed
 * 96 px allowance whatever the label said, so "Virus (representative)" ran
 * straight through "Human", and the Ruler drew its unit symbol on top of the
 * last tick label. A claim nobody can read is a claim that failed, so the same
 * standard applies to the words as to the marks.
 *
 * Width has to be estimated rather than measured: these modules are DOM-free by
 * design, and `getComputedTextLength` needs a live SVG. The estimate is
 * deliberately generous — erring wide drops a label, erring narrow overlaps one,
 * and the first is much the better failure. A Playwright test measures the real
 * rendered boxes and asserts nothing overlaps, so a bad estimate fails loudly
 * rather than quietly.
 */

/**
 * Advance width per character as a fraction of the font size, for the UI stack.
 * Measured against the rendered labels rather than taken from a table: the
 * widest real label ("Virus (representative)") comes out at about 0.55, and this
 * rounds up from there.
 */
const ADVANCE_PER_CHARACTER = 0.62;

/** Roughly how wide `text` will draw, in pixels, rounded up. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * ADVANCE_PER_CHARACTER;
}

export interface PlacedLabel<T> {
  readonly item: T;
  /** Row to draw on, staggering downwards. */
  readonly row: number;
}

export interface LabelBox {
  /** Where the label is anchored horizontally. */
  readonly x: number;
  /** Width it will occupy. */
  readonly width: number;
  /** Where the label starts, relative to `x`. 0 for start-anchored, -width/2 for middle. */
  readonly anchor: 'start' | 'middle' | 'end';
}

function leftEdge(box: LabelBox): number {
  if (box.anchor === 'start') return box.x;
  if (box.anchor === 'end') return box.x - box.width;
  return box.x - box.width / 2;
}

/**
 * Stagger labels across rows so none overlaps another on the same row.
 *
 * Items must be ordered left to right. A label that fits on no row gets row
 * `-1`, which callers draw as no label at all rather than as a collision.
 */
export function placeInRows<T>(
  items: readonly T[],
  boxOf: (item: T) => LabelBox,
  rows: number,
  options: {
    gap?: number;
    /** Drop labels that would run off the edge, where they are cut in half. */
    bounds?: { min: number; max: number };
  } = {},
): PlacedLabel<T>[] {
  const gap = options.gap ?? 6;
  const bounds = options.bounds;
  const rowEnds = new Array<number>(rows).fill(Number.NEGATIVE_INFINITY);
  return items.map((item) => {
    const box = boxOf(item);
    const start = leftEdge(box);
    if (bounds !== undefined && (start < bounds.min || start + box.width > bounds.max)) {
      return { item, row: -1 };
    }
    for (let row = 0; row < rows; row += 1) {
      if (start - rowEnds[row]! >= gap) {
        rowEnds[row] = start + box.width;
        return { item, row };
      }
    }
    return { item, row: -1 };
  });
}

/**
 * Keep the labels that fit on one line, dropping any that would collide with
 * the last one kept. Items must be ordered left to right.
 *
 * `reserved` boxes are already on the line — the Ruler's unit symbol sits in the
 * corner, and a tick label that runs into it has to go.
 */
export function keepNonOverlapping<T>(
  items: readonly T[],
  boxOf: (item: T) => LabelBox,
  options: {
    gap?: number;
    reserved?: readonly LabelBox[];
    /** Drop labels that would run off the edge, where they are cut in half. */
    bounds?: { min: number; max: number };
  } = {},
): T[] {
  const gap = options.gap ?? 6;
  const reserved = options.reserved ?? [];
  const bounds = options.bounds;
  const kept: T[] = [];
  let end = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const box = boxOf(item);
    const start = leftEdge(box);
    if (bounds !== undefined && (start < bounds.min || start + box.width > bounds.max)) continue;
    if (start - end < gap) continue;
    const clashesWithReserved = reserved.some(
      (other) =>
        start < leftEdge(other) + other.width + gap && leftEdge(other) < start + box.width + gap,
    );
    if (clashesWithReserved) continue;
    kept.push(item);
    end = start + box.width;
  }
  return kept;
}
