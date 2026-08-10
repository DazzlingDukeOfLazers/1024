/**
 * Two ways to turn a vector, and the trade between them.
 *
 * `rotation.ts` composes a rotation: apply the matrix, store the vector, repeat.
 * That is what most code does, and its error compounds, because the machine's
 * own output is the next step's input.
 *
 * The other way is to keep the **angle** and rebuild the vector from it. This
 * module is that, and the point is what it costs and what it saves.
 *
 * ## Why the angle can be exact
 *
 * The angle lives in a register scaled by π: the stored number is the angle in
 * units of π, so the bits above the point are half-turns and the bits below are
 * fractions of one. A binary register of that shape holds `k / 2^f` exactly and
 * nothing else, so the step angle has to be a **dyadic** multiple of π — and
 * π/8 is. Then:
 *
 * - accumulating `n` steps is integer addition, exact for every `n`;
 * - a full turn is exactly 2 in these units, so wrapping is dropping a bit
 *   rather than subtracting an approximation of 2π.
 *
 * The angle therefore never drifts, however long the run. After 16 steps it is
 * back to exactly zero, not nearly zero.
 *
 * ## What that costs
 *
 * Sine and cosine. **Niven's theorem** says the only rational multiples of π
 * whose sine is rational are those giving 0, ±1/2 and ±1 — so an angle that is
 * exactly representable in a π-scaled register has, apart from the quarter
 * turns, an irrational sine and cosine. You may have an exact angle or an exact
 * rotation matrix. Not both.
 *
 * `rotation.ts` takes the other side of that trade: cos θ = 3/5 and sin θ = 4/5
 * are exactly rational, and θ is consequently not a rational part of a turn at
 * all, so that orbit never closes and no angle register could hold its step.
 *
 * ## What the reference is, and is not
 *
 * Because the sines are irrational, the reference here is **declared rather
 * than exact** — 60 significant digits from `tools/oracle.py`, computed with
 * `decimal` at higher working precision. It is the first reference in this
 * project that is not exactly true, and everything downstream says so: an error
 * smaller than the last declared digit is not measured, it is invisible.
 */

import oracle from '../../../fixtures/oracle.json';
import {
  type Rational,
  ONE,
  ZERO,
  abs,
  add,
  compare,
  mul,
  rational,
  sub,
} from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';

const TABLE = oracle.rotation;

/** Steps in one full turn: 16, for a step of π/8. */
export const ANGLE_PERIOD = TABLE.period;
/** Significant digits the reference is trusted to. */
export const REFERENCE_DIGITS = TABLE.digits;

export interface Point {
  readonly x: Rational;
  readonly y: Rational;
}

/**
 * The declared position after `step` rotations of π/8 from (1, 0).
 *
 * Exact at the quarter turns and declared everywhere else, which the fixture
 * marks per entry rather than leaving to be inferred from the digits.
 */
export function referencePoint(step: number): { readonly point: Point; readonly exact: boolean } {
  const entry = TABLE.steps[((step % ANGLE_PERIOD) + ANGLE_PERIOD) % ANGLE_PERIOD]!;
  return {
    point: { x: parseDecimalExact(entry.cos), y: parseDecimalExact(entry.sin) },
    exact: entry.exact,
  };
}

/**
 * The angle after `step` steps, in units of π, wrapped into one turn.
 *
 * Integer arithmetic on the numerator: this is the whole reason the angle track
 * does not drift. `denominator` is 8, a power of two, so a π-scaled binary
 * register holds every one of these exactly.
 */
export function angleInPi(step: number): Rational {
  const wrapped = ((step % ANGLE_PERIOD) + ANGLE_PERIOD) % ANGLE_PERIOD;
  // Through `rational`, not built by hand. `equals` compares structurally on
  // the stated promise that every Rational is normalized, so an unnormalized
  // 8/8 here would not equal ONE anywhere in the codebase — a bug that would
  // have travelled a long way from this line before it was noticed.
  return rational(BigInt(wrapped), BigInt(TABLE.denominator));
}

export type Quantize = (value: Rational) => Rational | undefined;

export interface TrackSample {
  readonly step: number;
  /** Distance from the declared position. */
  readonly error: Rational;
  /** True when the reference for this step is exact rather than declared. */
  readonly referenceExact: boolean;
}

export interface TrackRun {
  readonly id: string;
  readonly label: string;
  readonly strategy: 'compose' | 'angle';
  readonly samples: readonly TrackSample[];
  readonly worstError: Rational;
  /** Error at the last step, which is what a long run leaves you holding. */
  readonly finalError: Rational;
  /**
   * True when a long run never does worse than its first full turn.
   *
   * This is the angle track's signature and the property worth naming: its
   * error is periodic, because step `n` and step `n + 16` compute the *same*
   * sine from the *same* exact angle. The composing track has no such ceiling —
   * its first turn is its best.
   *
   * An earlier version of this compared the worst error against a few multiples
   * of the first sample, which measured nothing in particular: the first step
   * of a sixteen-step cycle is not its worst, so a perfectly periodic run
   * failed the test.
   */
  readonly withinFirstTurn: boolean;
  /** Steps landing exactly on the declared position, error and all. */
  readonly exactSteps: number;
}

/** Squared distance. Kept squared: a square root is not exact. */
function distanceSquared(a: Point, b: Point): Rational {
  const dx = sub(a.x, b.x);
  const dy = sub(a.y, b.y);
  return add(mul(dx, dx), mul(dy, dy));
}

function summarize(
  id: string,
  label: string,
  strategy: 'compose' | 'angle',
  samples: readonly TrackSample[],
): TrackRun {
  let worst = ZERO;
  let firstTurnWorst = ZERO;
  let exactSteps = 0;
  for (const sample of samples) {
    if (compare(sample.error, worst) > 0) worst = sample.error;
    if (sample.step <= ANGLE_PERIOD && compare(sample.error, firstTurnWorst) > 0) {
      firstTurnWorst = sample.error;
    }
    if (compare(sample.error, ZERO) === 0) exactSteps += 1;
  }
  return {
    id,
    label,
    strategy,
    samples,
    worstError: worst,
    finalError: samples.at(-1)?.error ?? ZERO,
    withinFirstTurn: samples.length > 0 && compare(worst, firstTurnWorst) <= 0,
    exactSteps,
  };
}

/**
 * Track A: compose the rotation, step by step.
 *
 * The matrix entries are the machine's own rounded sine and cosine — a real
 * program would have no better — and each rotated vector is stored before the
 * next rotation reads it.
 */
export function runComposed(
  id: string,
  label: string,
  quantize: Quantize,
  steps: number,
): TrackRun {
  const first = referencePoint(1).point;
  const cos = quantize(first.x);
  const sin = quantize(first.y);
  const samples: TrackSample[] = [];
  if (cos === undefined || sin === undefined) return summarize(id, label, 'compose', samples);

  let point: Point = { x: ONE, y: ZERO };
  for (let step = 1; step <= steps; step += 1) {
    const x = quantize(sub(mul(cos, point.x), mul(sin, point.y)));
    const y = quantize(add(mul(sin, point.x), mul(cos, point.y)));
    if (x === undefined || y === undefined) break;
    point = { x, y };
    const reference = referencePoint(step);
    samples.push({
      step,
      error: distanceSquared(point, reference.point),
      referenceExact: reference.exact,
    });
  }
  return summarize(id, label, 'compose', samples);
}

/**
 * Track B: accumulate the angle, rebuild the vector.
 *
 * The angle is exact at every step and wraps for free, so the only error is one
 * rounding of a declared sine and cosine — and that rounding does not care how
 * many steps have gone before it.
 */
export function runAngle(id: string, label: string, quantize: Quantize, steps: number): TrackRun {
  const samples: TrackSample[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const reference = referencePoint(step);
    const x = quantize(reference.point.x);
    const y = quantize(reference.point.y);
    if (x === undefined || y === undefined) break;
    samples.push({
      step,
      error: distanceSquared({ x, y }, reference.point),
      referenceExact: reference.exact,
    });
  }
  return summarize(id, label, 'angle', samples);
}

/**
 * The step at which the composing track's error first exceeds the angle
 * track's, or `undefined` when it never does.
 *
 * There is a crossover because the two costs are different in kind: composing
 * pays nothing up front and accumulates, while the angle pays one rounding
 * immediately and then stops paying. Which is better is a question about how
 * many steps you intend to take, which is the same answer §10 gives about
 * division algorithms.
 */
export function crossoverStep(composed: TrackRun, angle: TrackRun): number | undefined {
  const limit = Math.min(composed.samples.length, angle.samples.length);
  for (let index = 0; index < limit; index += 1) {
    if (compare(composed.samples[index]!.error, angle.samples[index]!.error) > 0) {
      return composed.samples[index]!.step;
    }
  }
  return undefined;
}

/**
 * The reference's own last digit: below this, nothing is measured.
 *
 * Two of them, because the quantities being compared are of two kinds and the
 * first version conflated them — a squared distance is compared against the
 * square of the floor, and a first-order residue like `x² + y² − 1` against the
 * floor itself. Using the squared floor for both said the reference was good to
 * 120 digits, which it is not.
 */
export const REFERENCE_FLOOR: Rational = rational(1n, 10n ** BigInt(REFERENCE_DIGITS));
export const REFERENCE_FLOOR_SQUARED: Rational = mul(REFERENCE_FLOOR, REFERENCE_FLOOR);

/** True when a first-order residue is below the last declared digit. */
export function belowReferenceFloor(value: Rational): boolean {
  return compare(abs(value), REFERENCE_FLOOR) < 0;
}

/** True when a squared distance is below the last declared digit. */
export function belowReferenceFloorSquared(value: Rational): boolean {
  return compare(abs(value), REFERENCE_FLOOR_SQUARED) < 0;
}
