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

/* -------------------------------------------------------------------------- */
/* Two dimensions: where to put a block that must not sit on the data          */
/* -------------------------------------------------------------------------- */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Which candidate rectangle has the least data in it.
 *
 * The functions above solve a one-dimensional problem: labels along an axis,
 * competing for the same line. A chart legend is a different problem — a block
 * that has to sit somewhere in a plane that already has lines drawn through it
 * — so it gets its own function rather than a strained reading of those.
 *
 * The count is of *segments* crossing the rectangle, not of sample points
 * inside it. A polyline can cross a box cleanly between two samples: the
 * resolution chart's binary64 line has a sample every decade and a legend
 * narrower than a decade, so a point test would report the box empty while the
 * line ran through the words. That is the bug this exists to fix, and testing
 * points would have reproduced it.
 *
 * Ties go to the earliest candidate, so callers order candidates by preference.
 */
export function chooseClearRect(
  candidates: readonly Rect[],
  polylines: readonly (readonly Point[])[],
): number {
  if (candidates.length === 0) throw new Error('chooseClearRect needs a candidate');

  let best = 0;
  let bestCrossings = Number.POSITIVE_INFINITY;
  candidates.forEach((rect, index) => {
    let crossings = 0;
    for (const line of polylines) {
      for (let i = 0; i + 1 < line.length; i += 1) {
        if (segmentCrossesRect(line[i]!, line[i + 1]!, rect)) crossings += 1;
      }
      // A single-point line still occupies space.
      if (line.length === 1 && pointInRect(line[0]!, rect)) crossings += 1;
    }
    if (crossings < bestCrossings) {
      best = index;
      bestCrossings = crossings;
    }
  });
  return best;
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Liang–Barsky: does the segment intersect the rectangle at all? Endpoints
 * inside count, which is what "the line is in the box" means to a reader.
 */
function segmentCrossesRect(from: Point, to: Point, rect: Rect): boolean {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let leave = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel to this edge: inside or nothing to do
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
    return true;
  };

  return (
    clip(-dx, from.x - rect.x) &&
    clip(dx, rect.x + rect.width - from.x) &&
    clip(-dy, from.y - rect.y) &&
    clip(dy, rect.y + rect.height - from.y)
  );
}
