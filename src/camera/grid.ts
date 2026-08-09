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

import { type Rational, div, mul, pow10, rational } from '../core/rational/rational';
import { orderOfMagnitude10 } from '../core/rational/log10';
import { toSignificantDecimal } from '../core/rational/decimal';
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

export interface GridTick {
  /** Exact position in metres. */
  readonly meters: Rational;
  readonly x: number;
  readonly major: boolean;
  /** Present on major ticks only. */
  readonly label?: string;
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
): GridTick[] {
  const unit = gridLabelUnit(step);
  const minor = minorStep(step, camera);

  const majors = new Map<string, GridTick>();
  for (const meters of tickPositions(camera, viewport, step.spacing)) {
    const inUnit = div(meters, unit.metersPerUnit);
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
  return ticks.sort((a, b) => a.x - b.x);
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
