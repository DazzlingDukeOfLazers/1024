/**
 * The scaling ruler grid.
 *
 * docs/UI_SPEC.md "Grid behavior": pleasant 1/2/5 × 10^n spacings, roughly
 * 80–140 px between major divisions, and engineering-prefix boundaries that are
 * easy to recognise.
 *
 * The grid spacing changes as the camera zooms; the *scene* does not. Every
 * spacing is an exact rational and every tick is an exact integer multiple of
 * it, so changing the grid can never nudge an object.
 */

import {
  type Rational,
  ZERO,
  add,
  div,
  isZero,
  lt,
  mul,
  pow10,
  rational,
  sub,
} from '../core/rational/rational';
import { decomposeDecimal, orderOfMagnitude10 } from '../core/rational/log10';
import { toExactDecimalString, toSignificantDecimal } from '../core/rational/decimal';
import { canonicalUnitOf } from '../core/units/dimensions';
import { engineeringExponentFor, prefixByExponent } from '../core/units/prefixes';
import {
  type LinearCamera,
  type Viewport,
  lengthInPixels,
  metersPerPixel,
  tickPositions,
} from './camera';

/** The only significands a grid step may take. */
export const GRID_SIGNIFICANDS = [1, 2, 5] as const;
export type GridSignificand = (typeof GRID_SIGNIFICANDS)[number];

/** How many minor divisions sit inside one major, per significand. */
const SUBDIVISIONS: Readonly<Record<GridSignificand, number>> = { 1: 5, 2: 4, 5: 5 };

export const TARGET_MAJOR_PIXELS = 110;

export interface GridStep {
  /** Exact spacing in metres. */
  readonly spacing: Rational;
  readonly significand: GridSignificand;
  readonly exponent: number;
  /** Approximate on-screen spacing, for level-of-detail decisions. */
  readonly pixels: number;
}

/**
 * Pick the 1/2/5 × 10^n spacing whose on-screen size is closest to the target,
 * measured in log space so 60 px and 200 px are judged equally wrong.
 */
export function chooseGridStep(camera: LinearCamera, targetPixels = TARGET_MAJOR_PIXELS): GridStep {
  const ideal = mul(metersPerPixel(camera), rational(BigInt(Math.round(targetPixels))));
  const decade = orderOfMagnitude10(ideal);

  const candidates: GridStep[] = [];
  for (const exponent of [decade - 1, decade, decade + 1]) {
    for (const significand of GRID_SIGNIFICANDS) {
      const spacing = mul(rational(BigInt(significand)), pow10(exponent));
      candidates.push({
        spacing,
        significand,
        exponent,
        pixels: lengthInPixels(camera, spacing),
      });
    }
  }

  let best = candidates[0]!;
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!(candidate.pixels > 0) || !Number.isFinite(candidate.pixels)) continue;
    const error = Math.abs(Math.log(candidate.pixels) - Math.log(targetPixels));
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

/** The minor step nested inside a major one. */
export function minorStep(major: GridStep, camera: LinearCamera): GridStep {
  const divisions = SUBDIVISIONS[major.significand];
  const spacing = div(major.spacing, rational(BigInt(divisions)));
  return {
    spacing,
    significand: major.significand,
    exponent: major.exponent,
    pixels: lengthInPixels(camera, spacing),
  };
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export interface GridLabelUnit {
  /** e.g. `mm`. */
  readonly symbol: string;
  /** Exact metres per unit. */
  readonly metersPerUnit: Rational;
  readonly exponent: number;
}

/**
 * The engineering unit a grid at this spacing should be labelled in.
 *
 * Labelling ticks as plain numbers under one prefix — `0 1 2 3 mm` rather than
 * `0.001 m 0.002 m` — is what makes the nm → µm → mm → m → km transitions
 * legible as the camera zooms.
 */
export function gridLabelUnit(step: GridStep): GridLabelUnit {
  const exponent = engineeringExponentFor(step.exponent);
  const prefix = prefixByExponent(exponent);
  return {
    symbol: `${prefix?.symbol ?? ''}${canonicalUnitOf('length')}`,
    metersPerUnit: pow10(exponent),
    exponent,
  };
}

/**
 * The offset, written out for the axis — exactly.
 *
 * Six significant figures is what made the tick labels identical in the first
 * place, so the shared part cannot be rounded to six either: `offset + label`
 * has to be the tick, and a rounded offset would quietly make that false.
 * Scientific form keeps it short when the number is round (`1 × 10^23`) and
 * honest when it is not, by carrying every significant digit rather than the
 * first few.
 */
export function formatGridOffset(offset: Rational, unit: GridLabelUnit): string {
  const inUnit = div(offset, unit.metersPerUnit);
  const { sign, exponent, mantissa } = decomposeDecimal(inUnit);
  const digits = toExactDecimalString(mantissa);
  const magnitude =
    digits === undefined
      ? // Cannot happen for an offset — it is a multiple of a power of ten by
        // construction — but a wrong answer here would be a lie rather than an
        // inconvenience, so it says so instead of rounding.
        `${inUnit.numerator}/${inUnit.denominator}`
      : exponent === 0
        ? digits
        : `${digits} × 10^${exponent}`;
  return `${sign < 0 ? '−' : '+'}${magnitude} ${unit.symbol}`;
}

export interface GridTick {
  /** Exact position in metres. */
  readonly meters: Rational;
  readonly x: number;
  readonly major: boolean;
  /** Present on major ticks only. Relative to `GridLabels.offset` if there is one. */
  readonly label?: string;
}

export interface GridLabels {
  readonly ticks: readonly GridTick[];
  /**
   * The shared part of every label, factored out — exactly, so that
   * `offset + label × metresPerUnit` is the tick's absolute position and
   * nothing has been rounded away.
   *
   * `undefined` when the labels stand on their own, which is the ordinary case.
   */
  readonly offset?: Rational;
}

/**
 * Six significant digits stop distinguishing ticks once the magnitude is this
 * many times the spacing between them. Chosen with a decade in hand: at 10^6
 * the labels are already identical, and one distinguishing digit is not a grid
 * either.
 */
const OFFSET_NEEDED_RATIO = 5;

/**
 * The shared prefix worth factoring out of the labels, or `undefined`.
 *
 * At a 10^20 m origin the six tick labels came out as the *identical string*
 * `100000000000000000000000` — six positions, one number, which by this
 * project's own rule that a label is a claim was a false one. This is the
 * offset notation scientific plots use: state the shared part once beside the
 * axis and label the ticks by their difference from it.
 *
 * The offset is the **roundest** number within a span of the middle of the
 * view: the coarsest power of ten whose nearest multiple still lands close
 * enough to keep the tick labels small. Two earlier choices were worse and are
 * worth recording, because both looked reasonable:
 *
 *  - the first tick — it changes every time a tick scrolls off the edge,
 *    silently renumbering the whole axis for a pan of a few pixels;
 *  - the first tick floored to the span's granularity — that produced
 *    `99999999999999999990`, round in the arithmetic sense and useless to a
 *    reader, which is the defect again in a different costume.
 *
 * Rounding the midpoint instead gives exactly `10^20` at the preset that
 * prompted this, and the offset is always displayed in full rather than to six
 * significant figures, so `offset + label` is the tick exactly. One long number
 * shown once is the trade; six identical ones were the bug.
 */
export function gridLabelOffset(
  positions: readonly Rational[],
  spacing: Rational,
): Rational | undefined {
  if (positions.length < 2) return undefined;

  let low = positions[0]!;
  let high = positions[0]!;
  for (const position of positions) {
    if (lt(position, low)) low = position;
    if (lt(high, position)) high = position;
  }

  const magnitude = maxAbs(low, high);
  if (isZero(magnitude) || isZero(spacing)) return undefined;
  // Exact comparison: an offset earns its place only once six significant
  // digits have stopped telling adjacent ticks apart.
  if (lt(magnitude, mul(abs(spacing), pow10(OFFSET_NEEDED_RATIO)))) return undefined;

  const span = sub(high, low);
  const midpoint = div(add(low, high), rational(2n));
  const floor = orderOfMagnitude10(isZero(span) ? abs(spacing) : span);

  // Coarsest first, so the roundest candidate that fits wins.
  for (let exponent = orderOfMagnitude10(magnitude) + 1; exponent >= floor - 1; exponent -= 1) {
    const granularity = pow10(exponent);
    const candidate = mul(roundToNearest(div(midpoint, granularity)), granularity);
    if (isZero(candidate)) continue;
    if (!lt(span, abs(sub(candidate, midpoint)))) return candidate;
  }
  return undefined;
}

const abs = (value: Rational): Rational => (lt(value, ZERO) ? sub(ZERO, value) : value);
const maxAbs = (a: Rational, b: Rational): Rational => {
  const [x, y] = [abs(a), abs(b)];
  return lt(x, y) ? y : x;
};

/** Nearest integer, halves away from zero, as an exact rational. */
function roundToNearest(value: Rational): Rational {
  const half = rational(1n, 2n);
  const shifted = lt(value, ZERO) ? sub(value, half) : add(value, half);
  // Truncation toward zero is exactly right here: the half was already added
  // in the direction of the sign, so |value| + 1/2 truncated is |value|
  // rounded with halves away from zero.
  return rational(shifted.numerator / shifted.denominator);
}

/**
 * Every tick in view, majors labelled in the grid's engineering unit.
 *
 * Minor ticks that coincide with a major are dropped rather than drawn twice.
 */
export function gridTicks(
  camera: LinearCamera,
  viewport: Viewport,
  step: GridStep,
  toScreen: (meters: Rational) => number,
): GridLabels {
  const unit = gridLabelUnit(step);
  const minor = minorStep(step, camera);

  const majorPositions = [...tickPositions(camera, viewport, step.spacing)];
  const offset = gridLabelOffset(majorPositions, step.spacing);

  const majors = new Map<string, GridTick>();
  for (const meters of majorPositions) {
    const shown = offset === undefined ? meters : sub(meters, offset);
    const inUnit = div(shown, unit.metersPerUnit);
    majors.set(keyOf(meters), {
      meters,
      x: toScreen(meters),
      major: true,
      label: `${toSignificantDecimal(inUnit, 6).text}`,
    });
  }

  const ticks = [...majors.values()];
  // Below about 4 px apart, minor divisions are noise rather than information.
  if (minor.pixels >= 4) {
    for (const meters of tickPositions(camera, viewport, minor.spacing)) {
      if (majors.has(keyOf(meters))) continue;
      ticks.push({ meters, x: toScreen(meters), major: false });
    }
  }
  ticks.sort((a, b) => a.x - b.x);
  return offset === undefined ? { ticks } : { ticks, offset };
}

function keyOf(meters: Rational): string {
  return `${meters.numerator}/${meters.denominator}`;
}

/* -------------------------------------------------------------------------- */
/* Level of detail                                                             */
/* -------------------------------------------------------------------------- */

export type DetailLevel = 'detailed' | 'glyph' | 'aggregate';

/** Above this many pixels an object is worth drawing properly. */
export const DETAILED_PIXELS = 24;
/** Below this many pixels individual objects become a density strip. */
export const GLYPH_PIXELS = 3;

/**
 * docs/ARCHITECTURE.md "Browser performance": the underlying count never
 * changes, only how it is drawn. A thousand red blood cells stay a thousand
 * whether they are rendered as a thousand circles or as one strip.
 */
export function detailFor(sizePixels: number): DetailLevel {
  if (!(sizePixels > 0) || !Number.isFinite(sizePixels)) return 'aggregate';
  if (sizePixels >= DETAILED_PIXELS) return 'detailed';
  if (sizePixels >= GLYPH_PIXELS) return 'glyph';
  return 'aggregate';
}
