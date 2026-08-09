/**
 * The logarithmic atlas camera.
 *
 * docs/UI_SPEC.md §1: equal screen distance is equal change in log10, so the
 * Planck length and the observable universe can share one axis.
 *
 * The whole camera works in log space, where every coordinate is a small
 * double: 62 decades of physical range is 62 units here. That is what keeps
 * universe-scale magnitudes out of SVG geometry entirely (CLAUDE.md rule 7).
 *
 * Positions come from `log10RationalForDisplay`, which finds the decimal
 * exponent with integer comparisons and only ever converts a bounded [1, 10)
 * mantissa to a `number`. A value of 10^400 has no double at all, and the atlas
 * still places it (docs/NUMERICS.md §13).
 */

import { type Rational } from '../core/rational/rational';
import { log10RationalForDisplay } from '../core/rational/log10';
import { prefixByExponent } from '../core/units/prefixes';
import { canonicalUnitOf } from '../core/units/dimensions';
import { type Viewport } from './camera';

export interface LogCamera {
  /** log10 of the metres at the viewport centre. */
  readonly centerLog10: number;
  /** Screen pixels per decade. */
  readonly pixelsPerDecade: number;
}

export function createLogCamera(centerLog10: number, pixelsPerDecade: number): LogCamera {
  return { centerLog10, pixelsPerDecade };
}

export const MIN_PIXELS_PER_DECADE = 2;
export const MAX_PIXELS_PER_DECADE = 600;

export function atlasXFromLog10(camera: LogCamera, log10: number, viewport: Viewport): number {
  return viewport.widthPx / 2 + (log10 - camera.centerLog10) * camera.pixelsPerDecade;
}

/**
 * Place an exact physical magnitude on the axis.
 *
 * Only strictly positive values have a place on a log axis; zero and negatives
 * are the caller's problem to handle, not something to fake a position for.
 */
export function atlasX(camera: LogCamera, meters: Rational, viewport: Viewport): number {
  return atlasXFromLog10(camera, log10RationalForDisplay(meters), viewport);
}

export function log10FromAtlasX(camera: LogCamera, x: number, viewport: Viewport): number {
  return camera.centerLog10 + (x - viewport.widthPx / 2) / camera.pixelsPerDecade;
}

export function visibleDecades(
  camera: LogCamera,
  viewport: Viewport,
): { min: number; max: number } {
  return {
    min: log10FromAtlasX(camera, 0, viewport),
    max: log10FromAtlasX(camera, viewport.widthPx, viewport),
  };
}

export function panLogByPixels(camera: LogCamera, deltaPx: number): LogCamera {
  return { ...camera, centerLog10: camera.centerLog10 - deltaPx / camera.pixelsPerDecade };
}

/** Zoom about an anchor, keeping whatever is under it under it. */
export function zoomLogAt(
  camera: LogCamera,
  factor: number,
  anchorX: number,
  viewport: Viewport,
): LogCamera {
  const anchorLog10 = log10FromAtlasX(camera, anchorX, viewport);
  const pixelsPerDecade = Math.min(
    MAX_PIXELS_PER_DECADE,
    Math.max(MIN_PIXELS_PER_DECADE, camera.pixelsPerDecade * factor),
  );
  const offsetPixels = anchorX - viewport.widthPx / 2;
  return { centerLog10: anchorLog10 - offsetPixels / pixelsPerDecade, pixelsPerDecade };
}

/** Fit a span of decades into the viewport. */
export function frameDecades(
  minLog10: number,
  maxLog10: number,
  viewport: Viewport,
  padding = 0.06,
): LogCamera {
  const span = Math.max(maxLog10 - minLog10, 1e-6);
  const padded = span * (1 + padding * 2);
  return {
    centerLog10: (minLog10 + maxLog10) / 2,
    pixelsPerDecade: Math.min(
      MAX_PIXELS_PER_DECADE,
      Math.max(MIN_PIXELS_PER_DECADE, viewport.widthPx / padded),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The decade axis                                                             */
/* -------------------------------------------------------------------------- */

export interface DecadeTick {
  readonly exponent: number;
  readonly x: number;
  /**
   * True on the engineering boundaries — every third decade, where SI has a
   * prefix. docs/UI_SPEC.md wants those legible above the plain decades.
   */
  readonly engineering: boolean;
  /** `mm` on an engineering boundary, `10^-4 m` otherwise. */
  readonly label: string;
}

/** Never emit more ticks than could be read, however far out the camera is. */
export const MAX_DECADE_TICKS = 400;

export function decadeTicks(camera: LogCamera, viewport: Viewport): DecadeTick[] {
  const { min, max } = visibleDecades(camera, viewport);
  const first = Math.ceil(min);
  const last = Math.floor(max);
  if (last < first || last - first > MAX_DECADE_TICKS) return [];

  // At very low zoom, plain decades become a smear; keep only the engineering
  // boundaries rather than drawing lines nobody can distinguish.
  const engineeringOnly = camera.pixelsPerDecade < 14;

  const ticks: DecadeTick[] = [];
  for (let exponent = first; exponent <= last; exponent += 1) {
    const engineering = exponent % 3 === 0;
    if (engineeringOnly && !engineering) continue;
    ticks.push({
      exponent,
      x: atlasXFromLog10(camera, exponent, viewport),
      engineering,
      label: decadeLabel(exponent),
    });
  }
  return ticks;
}

export function decadeLabel(exponent: number): string {
  const unit = canonicalUnitOf('length');
  if (exponent % 3 !== 0) return `10^${exponent} ${unit}`;
  const prefix = prefixByExponent(exponent);
  // Beyond quetta and below quecto there is no prefix to use.
  return prefix === undefined ? `10^${exponent} ${unit}` : `${prefix.symbol}${unit}`;
}
