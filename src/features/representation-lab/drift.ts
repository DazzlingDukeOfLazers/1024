/**
 * Geometry for the drift sparklines.
 *
 * The Timeline prints signed divergence per checkpoint. What it cannot show is
 * the *shape*: whether a machine's error grows steadily, jumps, or cancels
 * itself back towards zero. TASKS asked for a sparkline per representation.
 *
 * Measured first, because two obvious charts both lie about the real data:
 *
 * - **Linear.** Over a million millimetres the Planck grid runs from 4 × 10^-37
 *   to 4 × 10^-31 m. On a linear axis the first fifteen checkpoints are pinned
 *   to zero and the last two are the whole picture, which reads as "nothing
 *   happened until the end" when in fact the error grew with every iteration.
 * - **Log magnitude alone.** binary64 on the same run goes +6.7 × 10^-16, then
 *   −1.0 × 10^-13, then +1.1 × 10^-10, then −4.9 × 10^-9. Its error *changes
 *   sign*, which is the whole reason signed and absolute error are tracked
 *   separately (docs/NUMERICS.md §6), and plotting |x| would erase it.
 *
 * So: log10 of the magnitude for position, sign carried alongside for the
 * renderer to mark, and exact zero kept off the axis entirely rather than
 * pushed to a floor — log 0 is not a number small enough to draw, it is a
 * different kind of answer, and the one this project cares most about.
 *
 * **Each row is drawn to its own vertical scale**, and this was the second thing
 * the measurement settled. A shared axis was the obvious choice — twenty-two
 * decades between binary64 and Q128.128 is the lens's own lesson, not a
 * rendering problem — and it was written that way, drawn, and looked at. Every
 * row came out a horizontal line: on a 22-decade axis a machine whose own
 * error spans half a decade has no shape at all. That is the Microscope's
 * lattice problem exactly, and it has the same answer — draw each row at its
 * own scale and make each row say what that scale is.
 *
 * Nothing is lost by it. The Timeline directly above prints every divergence
 * for every machine at every checkpoint, so the comparison between machines is
 * already there in numbers, which work across twenty-two decades where pixel
 * height cannot. What the table cannot show is the shape, and that is the only
 * job left for a picture.
 */

import { type Rational, abs, isZero, sign as signOf } from '../../core/rational/rational';
import { log10RationalForDisplay } from '../../core/rational/log10';

/** Fewer than this many checkpoints and there is no shape to draw. */
export const MINIMUM_POINTS = 3;

export interface DriftPoint {
  /** Index of the checkpoint this came from. */
  readonly index: number;
  /** 0 at the first checkpoint, 1 at the last. */
  readonly x: number;
  /**
   * 0 at the bottom of *this row's* range, 1 at the top — absent when the
   * divergence is exactly zero, which has no position on a logarithmic axis. A
   * row whose error never changes magnitude sits at 0.5 rather than on the
   * floor, where it would read as the smallest thing on the chart.
   */
  readonly y?: number | undefined;
  readonly sign: -1 | 0 | 1;
  /** log10 of the magnitude; absent at exact zero, for the same reason. */
  readonly log10?: number | undefined;
}

export interface DriftSeries {
  readonly id: string;
  readonly label: string;
  readonly points: readonly DriftPoint[];
  /** This machine's own extent, in log10 metres. Absent if it never diverged. */
  readonly minLog10?: number | undefined;
  readonly maxLog10?: number | undefined;
  /** How many times the sign flipped between non-zero checkpoints. */
  readonly signChanges: number;
  /** True when every checkpoint was exact. */
  readonly alwaysExact: boolean;
}

export interface DriftChart {
  /**
   * The extent across every machine. Stated in words rather than drawn: it is
   * how far apart the machines are, which the rows deliberately do not show.
   */
  readonly minLog10: number;
  readonly maxLog10: number;
  readonly series: readonly DriftSeries[];
  readonly pointCount: number;
}

export interface DriftInput {
  readonly id: string;
  readonly label: string;
  readonly divergences: readonly (Rational | undefined)[];
}

/**
 * `undefined` when there is nothing worth drawing: too few checkpoints, or
 * every machine exact at every one of them. A flat line at an invented floor
 * would claim a shape the run does not have.
 */
export function driftChart(inputs: readonly DriftInput[]): DriftChart | undefined {
  const pointCount = Math.max(0, ...inputs.map((input) => input.divergences.length));
  if (pointCount < MINIMUM_POINTS) return undefined;

  const magnitudes: number[] = [];
  for (const input of inputs) {
    for (const value of input.divergences) {
      if (value === undefined || isZero(value)) continue;
      magnitudes.push(log10RationalForDisplay(abs(value)));
    }
  }
  if (magnitudes.length === 0) return undefined;

  const series = inputs.map((input): DriftSeries => {
    const x = (index: number): number => (pointCount === 1 ? 0 : index / (pointCount - 1));

    // Two passes, because a row's own range is what positions its own points,
    // and it is not known until every checkpoint has been read.
    const own: number[] = [];
    for (const value of input.divergences) {
      if (value === undefined || isZero(value)) continue;
      own.push(log10RationalForDisplay(abs(value)));
    }

    if (own.length === 0) {
      return {
        id: input.id,
        label: input.label,
        points: input.divergences.map((_, index) => ({ index, x: x(index), sign: 0 as const })),
        signChanges: 0,
        alwaysExact: true,
      };
    }

    const rowMin = Math.min(...own);
    const rowMax = Math.max(...own);
    const rowSpan = rowMax - rowMin;

    let signChanges = 0;
    let previousSign: -1 | 1 | undefined;
    const points = input.divergences.map((value, index): DriftPoint => {
      if (value === undefined || isZero(value)) return { index, x: x(index), sign: 0 };

      const sign: -1 | 1 = signOf(value) < 0 ? -1 : 1;
      if (previousSign !== undefined && previousSign !== sign) signChanges += 1;
      previousSign = sign;

      const log10 = log10RationalForDisplay(abs(value));
      return {
        index,
        x: x(index),
        // A row whose magnitude never moves has no top and no bottom. Half way
        // up says "flat"; zero would say "smallest", which is a claim.
        y: rowSpan === 0 ? 0.5 : (log10 - rowMin) / rowSpan,
        sign,
        log10,
      };
    });

    return {
      id: input.id,
      label: input.label,
      points,
      signChanges,
      alwaysExact: false,
      minLog10: rowMin,
      maxLog10: rowMax,
    };
  });

  return {
    minLog10: Math.min(...magnitudes),
    maxLog10: Math.max(...magnitudes),
    series,
    pointCount,
  };
}

/**
 * The polyline runs of a series: consecutive non-zero points only.
 *
 * A segment joining "exactly zero" to 10^-37 m would be drawing a line across a
 * gap the axis cannot express. Exact checkpoints break the line and are marked
 * separately, so a machine that was right and then stopped being right looks
 * like that rather than like one that was always slightly wrong.
 */
export function driftRuns(series: DriftSeries): DriftPoint[][] {
  const runs: DriftPoint[][] = [];
  let current: DriftPoint[] = [];
  for (const point of series.points) {
    if (point.y === undefined) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}
