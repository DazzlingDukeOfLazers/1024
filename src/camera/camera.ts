/**
 * The linear ruler camera.
 *
 * docs/UI_SPEC.md "Camera model" and docs/NUMERICS.md §12. The camera centre is
 * an exact rational in metres; the zoom is a double, because it is display
 * state rather than an authoritative physical quantity.
 *
 * The rule that makes this worth writing at all:
 *
 *     deltaExact = objectPositionExact - cameraOriginExact
 *     screenX    = boundedNumber(deltaExact / metersPerPixel)
 *
 * and never `Number(objectPosition) - Number(cameraOrigin)`, because a
 * millimetre at a 1e20 m offset disappears before rendering even begins.
 *
 * No DOM access here — this is domain math (docs/ARCHITECTURE.md).
 */

import {
  type Rational,
  ONE,
  add,
  ceilToBigInt,
  div,
  floorToBigInt,
  mul,
  pow10,
  rational,
  sub,
} from '../core/rational/rational';
import { log10RationalForDisplay, toNumberForDisplay } from '../core/rational/log10';
import { exactValue } from '../core/representations/binary64';

export interface LinearCamera {
  /** Exact metres at the centre of the viewport. */
  readonly centerMeters: Rational;
  /** log10 of metres per pixel. A double: display state, not physics. */
  readonly metersPerPixelLog10: number;
}

export interface Viewport {
  readonly widthPx: number;
  readonly heightPx: number;
}

export function createCamera(centerMeters: Rational, metersPerPixelLog10: number): LinearCamera {
  return { centerMeters, metersPerPixelLog10 };
}

/**
 * The zoom factor as an exact rational.
 *
 * The double exponent is split into a decade and a bounded mantissa; the
 * mantissa's *exact* binary64 value becomes the rational. Whatever double the
 * camera happens to hold, the geometry below is exact with respect to it.
 */
export function metersPerPixel(camera: LinearCamera): Rational {
  const decade = Math.floor(camera.metersPerPixelLog10);
  const mantissa = Math.pow(10, camera.metersPerPixelLog10 - decade);
  const exactMantissa = exactValue(mantissa) ?? ONE;
  return mul(pow10(decade), exactMantissa);
}

/** Exact metres spanned by the viewport. */
export function visibleWidthMeters(camera: LinearCamera, viewport: Viewport): Rational {
  return mul(metersPerPixel(camera), rational(BigInt(Math.round(viewport.widthPx))));
}

/** Exact metres at the left and right edges. */
export function visibleRange(
  camera: LinearCamera,
  viewport: Viewport,
): { min: Rational; max: Rational } {
  const half = div(visibleWidthMeters(camera, viewport), rational(2n));
  return { min: sub(camera.centerMeters, half), max: add(camera.centerMeters, half) };
}

/**
 * Physical position to screen pixels.
 *
 * The origin subtraction happens in exact arithmetic; only the bounded local
 * delta becomes a `number`. Positions far outside the viewport saturate rather
 * than producing garbage.
 */
export function toScreenX(
  camera: LinearCamera,
  positionMeters: Rational,
  viewport: Viewport,
): number {
  const delta = sub(positionMeters, camera.centerMeters);
  return viewport.widthPx / 2 + toNumberForDisplay(div(delta, metersPerPixel(camera)));
}

/** Screen pixels back to an exact physical position. */
export function fromScreenX(camera: LinearCamera, x: number, viewport: Viewport): Rational {
  const offsetPixels = exactValue(x - viewport.widthPx / 2) ?? rational(0n);
  return add(camera.centerMeters, mul(offsetPixels, metersPerPixel(camera)));
}

/**
 * Exact pixel span of a physical length. Used for level-of-detail decisions,
 * where the answer is always small enough for a double.
 */
export function lengthInPixels(camera: LinearCamera, lengthMeters: Rational): number {
  return toNumberForDisplay(div(lengthMeters, metersPerPixel(camera)));
}

/* -------------------------------------------------------------------------- */
/* Movement                                                                    */
/* -------------------------------------------------------------------------- */

/** Pan by a pixel delta. Dragging right moves the camera left. */
export function panByPixels(camera: LinearCamera, deltaPx: number): LinearCamera {
  const offset = exactValue(deltaPx) ?? rational(0n);
  return {
    ...camera,
    centerMeters: sub(camera.centerMeters, mul(offset, metersPerPixel(camera))),
  };
}

export const MIN_ZOOM_LOG10 = -40;
export const MAX_ZOOM_LOG10 = 30;

/**
 * Zoom, keeping whatever is under `anchorX` under `anchorX`.
 *
 * The anchor's physical position is resolved exactly before the zoom changes
 * and re-centred exactly after, so repeated wheel events do not accumulate the
 * drift a float round-trip would introduce.
 */
export function zoomAt(
  camera: LinearCamera,
  deltaLog10: number,
  anchorX: number,
  viewport: Viewport,
): LinearCamera {
  const anchorMeters = fromScreenX(camera, anchorX, viewport);
  const zoomed: LinearCamera = {
    ...camera,
    metersPerPixelLog10: Math.min(
      MAX_ZOOM_LOG10,
      Math.max(MIN_ZOOM_LOG10, camera.metersPerPixelLog10 + deltaLog10),
    ),
  };

  const anchorOffsetPixels = exactValue(anchorX - viewport.widthPx / 2) ?? rational(0n);
  return {
    ...zoomed,
    centerMeters: sub(anchorMeters, mul(anchorOffsetPixels, metersPerPixel(zoomed))),
  };
}

/** Frame a length so it occupies `fraction` of the viewport width. */
export function frameLength(
  centerMeters: Rational,
  lengthMeters: Rational,
  viewport: Viewport,
  fraction = 0.6,
): LinearCamera {
  const targetPixels = viewport.widthPx * fraction;
  const perPixel = div(lengthMeters, exactValue(targetPixels) ?? ONE);
  return {
    centerMeters,
    // The exact-safe path, so framing an object works at any scale — including
    // ones whose metres-per-pixel is far outside binary64's range.
    metersPerPixelLog10: log10RationalForDisplay(perPixel),
  };
}

/* -------------------------------------------------------------------------- */
/* Tick positions                                                              */
/* -------------------------------------------------------------------------- */

/** Guard against a pathological camera asking for millions of ticks. */
export const MAX_TICKS = 512;

/**
 * Exact positions of every multiple of `spacing` inside the viewport.
 *
 * The multiples are integers, so each position is an exact rational and the
 * grid can never drift away from the objects it is measuring.
 */
export function tickPositions(
  camera: LinearCamera,
  viewport: Viewport,
  spacing: Rational,
): Rational[] {
  const { min, max } = visibleRange(camera, viewport);
  const first = ceilToBigInt(div(min, spacing));
  const last = floorToBigInt(div(max, spacing));

  if (last < first) return [];
  if (last - first > BigInt(MAX_TICKS)) return [];

  const positions: Rational[] = [];
  for (let k = first; k <= last; k += 1n) {
    positions.push(mul(rational(k), spacing));
  }
  return positions;
}
