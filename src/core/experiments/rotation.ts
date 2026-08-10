/**
 * Repeated rotation, and what it costs each machine to keep turning.
 *
 * PROJECT_SPEC §7 lists repeated rotations beside velocity integration as the
 * kind of workload that exposes representation error. Every other experiment
 * here drifts a *value*; this one drifts a **shape**. A rotation must not change
 * a vector's length, so the length is a conserved quantity the machine is
 * supposed to preserve and cannot, and the error has somewhere obvious to show
 * up that has nothing to do with the numbers being large or small.
 *
 * ## Why this angle
 *
 * A rotation by a nice angle is not usable here. `cos 1°` is irrational, so the
 * exact reference would itself be an approximation and the whole comparison
 * would be against a fiction — CLAUDE.md rule 1 forbids exactly that.
 *
 * The way out is a Pythagorean triple. With `cos θ = 3/5` and `sin θ = 4/5`
 * both entries are exact rationals and `3² + 4² = 5²`, so the matrix is exactly
 * orthogonal and the exact orbit stays exactly on the circle for ever. θ is
 * about 53.13°, and — the part that makes repetition interesting — θ is not a
 * rational multiple of a turn, so the orbit never closes and never repeats.
 * There is no step at which the exact answer conveniently returns to the start.
 *
 * ## What it costs to be exact
 *
 * Nothing is free. After `n` rotations the exact coordinates have denominator
 * `5^n`, so the numerator grows by about 0.7 digits per step: 46 digits after
 * 64 rotations, and it never stops. **The exact reference does not drift and
 * does not fit.** The finite machines have the opposite problem, and putting
 * both costs in one table is the point of the experiment — this project spends
 * most of its time showing what finite representations lose, and rather less
 * showing what exactness charges for the privilege.
 */

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

/** `cos θ` for the 3-4-5 rotation. */
export const ROTATION_COS = rational(3n, 5n);
/** `sin θ` for the same rotation, about 53.13°. */
export const ROTATION_SIN = rational(4n, 5n);

export interface Point {
  readonly x: Rational;
  readonly y: Rational;
}

/** One exact rotation. Orthogonal, so it preserves length exactly. */
export function rotateExact(point: Point): Point {
  return {
    x: sub(mul(ROTATION_COS, point.x), mul(ROTATION_SIN, point.y)),
    y: add(mul(ROTATION_SIN, point.x), mul(ROTATION_COS, point.y)),
  };
}

/**
 * Where the machine is allowed to be finite.
 *
 * `docs/NUMERICS.md` §7 separates operand encoding error from operation
 * rounding error, and these are those two categories made into an experiment
 * you can run:
 *
 * - `store` — the arithmetic is exact and only the *result* is quantized. The
 *   machine's registers are finite; its arithmetic unit is not.
 * - `operate` — every multiply and every add lands in a register first, which
 *   is what a real machine does.
 *
 * They are not two shades of the same answer. Over 200 rotations binary64's
 * vector **shrinks** under `store` (36 samples above the circle, 164 below) and
 * **grows** under `operate` (170 above, 30 below). Same rotation, same machine,
 * same starting vector, and the drift reverses sign — which is as sharp a
 * statement of §7's distinction as this project has found. Q128.128 shrinks
 * either way, so the reversal is a fact about binary64 rather than a law.
 */
export type RotationMode = 'store' | 'operate';

/** One rotation as a given machine performs it. */
function rotateIn(point: Point, quantize: Quantize, mode: RotationMode): Point | undefined {
  if (mode === 'store') {
    const x = quantize(sub(mul(ROTATION_COS, point.x), mul(ROTATION_SIN, point.y)));
    const y = quantize(add(mul(ROTATION_SIN, point.x), mul(ROTATION_COS, point.y)));
    return x === undefined || y === undefined ? undefined : { x, y };
  }

  const cx = quantize(mul(ROTATION_COS, point.x));
  const sy = quantize(mul(ROTATION_SIN, point.y));
  const sx = quantize(mul(ROTATION_SIN, point.x));
  const cy = quantize(mul(ROTATION_COS, point.y));
  if (cx === undefined || sy === undefined || sx === undefined || cy === undefined)
    return undefined;
  const x = quantize(sub(cx, sy));
  const y = quantize(add(sx, cy));
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** `x² + y²`. Compared against 1 rather than square-rooted: a root is not exact. */
export function normSquared(point: Point): Rational {
  return add(mul(point.x, point.x), mul(point.y, point.y));
}

/**
 * How a machine holds a coordinate.
 *
 * Returning `undefined` means the machine could not hold it at all, which is a
 * result rather than an error — a register that overflows has said something.
 */
export type Quantize = (value: Rational) => Rational | undefined;

export interface RotationSample {
  /** 1-based; step 0 is the starting vector and is not a rotation. */
  readonly step: number;
  readonly point: Point;
  /** `x² + y² − 1`. Exactly zero for the exact orbit, at every step. */
  readonly normError: Rational;
}

export interface RotationRun {
  readonly id: string;
  readonly label: string;
  readonly mode: RotationMode;
  readonly samples: readonly RotationSample[];
  /** Largest `|x² + y² − 1|` reached. */
  readonly worstNormError: Rational;
  /** Checkpoints whose vector is longer than it should be, and shorter. */
  readonly stepsTooLong: number;
  readonly stepsTooShort: number;
  /**
   * Which way the vector drifted overall — the headline, because it is the part
   * that changes with the mode rather than merely getting bigger.
   */
  readonly drift: 'outward' | 'inward' | 'balanced';
  /** Set when the machine stopped being able to hold a coordinate. */
  readonly failedAtStep?: number | undefined;
}

/**
 * Turn a vector `steps` times, quantizing both coordinates after each turn.
 *
 * Quantizing *after each rotation* rather than at the end is the whole point:
 * the machine's own output is the next rotation's input, so its errors compound
 * the way they do in a real loop.
 */
export function runRotation(
  id: string,
  label: string,
  quantize: Quantize,
  steps: number,
  mode: RotationMode = 'store',
  start: Point = { x: ONE, y: ZERO },
): RotationRun {
  const samples: RotationSample[] = [];
  let point = start;
  let worst = ZERO;
  let stepsTooLong = 0;
  let stepsTooShort = 0;
  let failedAtStep: number | undefined;

  for (let step = 1; step <= steps; step += 1) {
    const next = rotateIn(point, quantize, mode);
    if (next === undefined) {
      failedAtStep = step;
      break;
    }
    point = next;

    const normError = sub(normSquared(point), ONE);
    const sign = compare(normError, ZERO);
    if (sign > 0) stepsTooLong += 1;
    else if (sign < 0) stepsTooShort += 1;
    if (compare(abs(normError), worst) > 0) worst = abs(normError);

    samples.push({ step, point, normError });
  }

  return {
    id,
    label,
    mode,
    samples,
    worstNormError: worst,
    stepsTooLong,
    stepsTooShort,
    drift:
      stepsTooLong > stepsTooShort
        ? 'outward'
        : stepsTooShort > stepsTooLong
          ? 'inward'
          : 'balanced',
    ...(failedAtStep === undefined ? {} : { failedAtStep }),
  };
}

/**
 * How many decimal digits the exact numerator needs after `steps` rotations.
 *
 * The denominator is `5^steps` exactly, so this grows without bound — the price
 * of never drifting. Computed rather than estimated, because "about 0.7 digits
 * a step" is the kind of claim this project makes a machine settle.
 */
export function exactDigitsAfter(steps: number, start: Point = { x: ONE, y: ZERO }): number {
  let point = start;
  for (let i = 0; i < steps; i += 1) point = rotateExact(point);
  const digits = (value: bigint): number => (value < 0n ? -value : value).toString().length;
  return Math.max(
    digits(point.x.numerator),
    digits(point.y.numerator),
    digits(point.x.denominator),
    digits(point.y.denominator),
  );
}
