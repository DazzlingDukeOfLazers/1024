import { describe, expect, it } from 'vitest';
import {
  type Viewport,
  createCamera,
  fromScreenX,
  frameLength,
  lengthInPixels,
  metersPerPixel,
  panByPixels,
  tickPositions,
  toScreenX,
  visibleRange,
  zoomAt,
} from './camera';
import {
  ONE,
  ZERO,
  abs,
  add,
  equals,
  lt,
  mul,
  pow10,
  rational,
  sub,
} from '../core/rational/rational';
import { toNumberForDisplay } from '../core/rational/log10';
import { parseDecimalExact } from '../core/rational/parse';
import { fromUnit } from '../core/quantities/quantity';

const r = rational;
const viewport: Viewport = { widthPx: 1000, heightPx: 300 };

describe('the zoom factor', () => {
  it('is exact with respect to whatever double the camera holds', () => {
    expect(metersPerPixel(createCamera(ZERO, 0))).toEqual(ONE);
    expect(metersPerPixel(createCamera(ZERO, -3))).toEqual(pow10(-3));
    expect(metersPerPixel(createCamera(ZERO, 6))).toEqual(pow10(6));
  });

  it('handles fractional zoom exponents', () => {
    const camera = createCamera(ZERO, -2.5);
    const perPixel = metersPerPixel(camera);
    // Between 1e-3 and 1e-2, and exact as a rational.
    expect(lt(pow10(-3), perPixel)).toBe(true);
    expect(lt(perPixel, pow10(-2))).toBe(true);
    expect(perPixel.denominator > 0n).toBe(true);
  });
});

describe('the transform', () => {
  const camera = createCamera(ZERO, -3); // 1 mm per pixel

  it('puts the camera centre in the middle of the viewport', () => {
    expect(toScreenX(camera, ZERO, viewport)).toBe(500);
  });

  it('scales by metres per pixel', () => {
    expect(toScreenX(camera, fromUnit(ONE, 'mm').value, viewport)).toBeCloseTo(501, 9);
    expect(toScreenX(camera, fromUnit(r(100n), 'mm').value, viewport)).toBeCloseTo(600, 9);
    expect(toScreenX(camera, fromUnit(r(-100n), 'mm').value, viewport)).toBeCloseTo(400, 9);
  });

  it('round-trips through screen space exactly', () => {
    for (const x of [0, 250, 500, 750, 1000]) {
      const meters = fromScreenX(camera, x, viewport);
      expect(toScreenX(camera, meters, viewport)).toBeCloseTo(x, 9);
    }
  });

  it('saturates far-off positions instead of producing garbage', () => {
    const absurd = toScreenX(camera, pow10(400), viewport);
    expect(absurd).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports the visible range exactly', () => {
    const { min, max } = visibleRange(camera, viewport);
    expect(sub(max, min)).toEqual(fromUnit(r(1000n), 'mm').value);
    expect(add(min, max)).toEqual(ZERO);
  });
});

describe('a millimetre beside a 1e20 m origin', () => {
  // The regression docs/TEST_STRATEGY.md requires, and the reason the camera
  // holds an exact rational centre at all.
  const origin = pow10(20);
  const millimetre = parseDecimalExact('0.001');
  const camera = createCamera(origin, -5); // 10 µm per pixel

  const positionA = origin;
  const positionB = add(origin, millimetre);

  it('keeps the two positions separately drawable', () => {
    const xa = toScreenX(camera, positionA, viewport);
    const xb = toScreenX(camera, positionB, viewport);

    expect(xa).toBe(500);
    expect(xb).toBeCloseTo(600, 6);
    expect(Math.abs(xb - xa)).toBeGreaterThan(1);
  });

  it('demonstrates both forbidden paths failing, without using either', () => {
    // docs/NUMERICS.md §12 forbids converting first and subtracting after. It
    // fails in two different ways, and both are worth seeing.

    // Convert each position to a double, then subtract: the millimetre is gone,
    // because 1e20 and 1e20 + 1mm are the same double.
    expect(toNumberForDisplay(positionB) - toNumberForDisplay(positionA)).toBe(0);

    // Divide the rational's parts as doubles instead: worse. 10^23 is not
    // representable, so this does not merely lose the millimetre — it invents
    // 16384 m of error, one binary64 gap at that magnitude, from nothing.
    const componentwise = Number(positionB.numerator) / Number(positionB.denominator) - 1e20;
    expect(componentwise).toBe(16384);

    // The camera, meanwhile, resolves the millimetre across 100 px.
    expect(
      toScreenX(camera, positionB, viewport) - toScreenX(camera, positionA, viewport),
    ).toBeCloseTo(100, 6);
  });

  it('still resolves the separation a hundred times finer', () => {
    const finer = createCamera(origin, -7); // 100 nm per pixel
    const separation =
      toScreenX(finer, positionB, viewport) - toScreenX(finer, positionA, viewport);
    expect(separation).toBeCloseTo(10000, 3);
  });

  it('keeps the grid on exact multiples out there too', () => {
    const ticks = tickPositions(camera, viewport, millimetre);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      // Every tick is an exact integer number of millimetres from zero.
      const multiples = mul(tick, r(1000n));
      expect(multiples.denominator).toBe(1n);
    }
  });
});

describe('panning', () => {
  const camera = createCamera(ZERO, -3);

  it('moves the centre by an exact number of metres', () => {
    const panned = panByPixels(camera, 100);
    expect(panned.centerMeters).toEqual(fromUnit(r(-100n), 'mm').value);
    expect(panned.metersPerPixelLog10).toBe(camera.metersPerPixelLog10);
  });

  it('is exactly reversible, however many times it is repeated', () => {
    let moved = camera;
    for (let i = 0; i < 500; i += 1) moved = panByPixels(moved, 7);
    for (let i = 0; i < 500; i += 1) moved = panByPixels(moved, -7);
    // Exact rationals do not accumulate drift the way a float centre would.
    expect(moved.centerMeters).toEqual(camera.centerMeters);
  });

  it('keeps working at a 1e20 m offset', () => {
    const far = createCamera(pow10(20), -5);
    const panned = panByPixels(far, 1);
    expect(equals(panned.centerMeters, far.centerMeters)).toBe(false);
    expect(sub(far.centerMeters, panned.centerMeters)).toEqual(pow10(-5));
  });
});

describe('zooming', () => {
  const camera = createCamera(ZERO, 0);

  it('keeps the anchor point under the cursor', () => {
    const anchorX = 250;
    const before = fromScreenX(camera, anchorX, viewport);
    const zoomed = zoomAt(camera, -1, anchorX, viewport);

    expect(zoomed.metersPerPixelLog10).toBe(-1);
    expect(fromScreenX(zoomed, anchorX, viewport)).toEqual(before);
    expect(toScreenX(zoomed, before, viewport)).toBeCloseTo(anchorX, 9);
  });

  it('keeps the centre fixed when the anchor is the centre', () => {
    const zoomed = zoomAt(camera, 2, viewport.widthPx / 2, viewport);
    expect(zoomed.centerMeters).toEqual(camera.centerMeters);
  });

  it('does not drift over many wheel events', () => {
    const anchorX = 317;
    const anchorMeters = fromScreenX(camera, anchorX, viewport);

    let zoomed = camera;
    for (let i = 0; i < 200; i += 1) zoomed = zoomAt(zoomed, -0.05, anchorX, viewport);
    // The anchor's physical position is resolved exactly each time, so it is
    // still exactly where it started after ten decades of zoom.
    expect(fromScreenX(zoomed, anchorX, viewport)).toEqual(anchorMeters);
  });

  it('clamps rather than running off the end of the scale', () => {
    let zoomed = camera;
    for (let i = 0; i < 100; i += 1) zoomed = zoomAt(zoomed, -1, 500, viewport);
    expect(zoomed.metersPerPixelLog10).toBe(-40);
    expect(Number.isFinite(zoomed.metersPerPixelLog10)).toBe(true);
  });
});

describe('framing', () => {
  it('sizes a length to a fraction of the viewport', () => {
    const camera = frameLength(ZERO, ONE, viewport, 0.5);
    expect(lengthInPixels(camera, ONE)).toBeCloseTo(500, 6);
  });

  it('frames a red blood cell and the observable universe alike', () => {
    const cell = fromUnit(parseDecimalExact('7.5'), 'µm').value;
    const universe = parseDecimalExact('8.8e26');

    expect(lengthInPixels(frameLength(ZERO, cell, viewport), cell)).toBeCloseTo(600, 3);
    expect(lengthInPixels(frameLength(ZERO, universe, viewport), universe)).toBeCloseTo(600, -2);
  });
});

describe('tick positions', () => {
  const camera = createCamera(ZERO, -3);

  it('lands on exact multiples of the spacing', () => {
    const spacing = fromUnit(r(100n), 'mm').value;
    const ticks = tickPositions(camera, viewport, spacing);
    expect(ticks).toContainEqual(ZERO);
    for (const tick of ticks) {
      const multiple = mul(tick, rational(spacing.denominator, spacing.numerator));
      expect(multiple.denominator).toBe(1n);
    }
  });

  it('covers the viewport and no more', () => {
    const spacing = fromUnit(r(100n), 'mm').value;
    const { min, max } = visibleRange(camera, viewport);
    for (const tick of tickPositions(camera, viewport, spacing)) {
      expect(lt(tick, min)).toBe(false);
      expect(lt(max, tick)).toBe(false);
    }
  });

  it('refuses to generate an absurd number of ticks', () => {
    // A spacing far below one pixel would imply millions of lines.
    expect(tickPositions(camera, viewport, pow10(-30))).toEqual([]);
  });
});

describe('lengthInPixels', () => {
  it('measures an object against the current zoom', () => {
    const camera = createCamera(ZERO, -6); // 1 µm per pixel
    const cell = fromUnit(parseDecimalExact('7.5'), 'µm').value;
    expect(lengthInPixels(camera, cell)).toBeCloseTo(7.5, 9);
  });

  it('stays finite for a length far below the zoom level', () => {
    const camera = createCamera(ZERO, 6);
    expect(lengthInPixels(camera, abs(pow10(-40)))).toBeCloseTo(0, 12);
  });
});
