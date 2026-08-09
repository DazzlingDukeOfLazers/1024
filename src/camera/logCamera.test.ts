import { describe, expect, it } from 'vitest';
import {
  MAX_PIXELS_PER_DECADE,
  MIN_PIXELS_PER_DECADE,
  atlasX,
  atlasXFromLog10,
  createLogCamera,
  decadeLabel,
  decadeTicks,
  frameDecades,
  log10FromAtlasX,
  panLogByPixels,
  visibleDecades,
  zoomLogAt,
} from './logCamera';
import { type Viewport } from './camera';
import { ONE, pow10, rational } from '../core/rational/rational';
import { parseDecimalExact } from '../core/rational/parse';
import { toNumberForDisplay } from '../core/rational/log10';
import { fromUnit } from '../core/quantities/quantity';

const r = rational;
const viewport: Viewport = { widthPx: 1000, heightPx: 300 };

describe('placing magnitudes on the axis', () => {
  const camera = createLogCamera(0, 20); // 1 m at centre, 20 px per decade

  it('puts the centre magnitude in the middle', () => {
    expect(atlasX(camera, ONE, viewport)).toBeCloseTo(500, 9);
  });

  it('spaces equal ratios equally', () => {
    // Every decade is the same 20 px, whatever the magnitude.
    const oneMetre = atlasX(camera, ONE, viewport);
    const tenMetres = atlasX(camera, r(10n), viewport);
    const hundredMetres = atlasX(camera, r(100n), viewport);
    expect(tenMetres - oneMetre).toBeCloseTo(20, 9);
    expect(hundredMetres - tenMetres).toBeCloseTo(20, 9);

    const millimetre = atlasX(camera, fromUnit(ONE, 'mm').value, viewport);
    expect(oneMetre - millimetre).toBeCloseTo(60, 9);
  });

  it('round-trips through screen space', () => {
    for (const x of [0, 250, 500, 1000]) {
      const log10 = log10FromAtlasX(camera, x, viewport);
      expect(atlasXFromLog10(camera, log10, viewport)).toBeCloseTo(x, 9);
    }
  });

  it('reports the visible span in decades', () => {
    const { min, max } = visibleDecades(camera, viewport);
    expect(max - min).toBeCloseTo(50, 9);
    expect((min + max) / 2).toBeCloseTo(0, 9);
  });
});

describe('positioning values binary64 cannot hold', () => {
  // The acceptance criterion from docs/IMPLEMENTATION_PLAN.md, and the reason
  // the atlas uses log10RationalForDisplay rather than a Number conversion.
  const camera = createLogCamera(200, 2);

  it('places 10^400, which has no double at all', () => {
    expect(toNumberForDisplay(pow10(400))).toBe(Number.POSITIVE_INFINITY);

    const x = atlasX(camera, pow10(400), viewport);
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeCloseTo(500 + 200 * 2, 6);
  });

  it('places 10^-400 too', () => {
    expect(toNumberForDisplay(pow10(-400))).toBe(0);
    const x = atlasX(createLogCamera(-200, 2), pow10(-400), viewport);
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeCloseTo(500 - 200 * 2, 6);
  });

  it('keeps the ordering across the whole absurd range', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let exponent = -400; exponent <= 400; exponent += 10) {
      const x = atlasX(createLogCamera(0, 1), pow10(exponent), viewport);
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
  });

  it('never produces a giant SVG coordinate for anything in view', () => {
    // 62 decades of real catalog range is 62 units in log space, so screen
    // coordinates stay small no matter how extreme the physical magnitude.
    const framed = frameDecades(-35, 27, viewport);
    for (const exponent of [-35, -20, 0, 20, 27]) {
      const x = atlasXFromLog10(framed, exponent, viewport);
      expect(Math.abs(x)).toBeLessThan(2000);
    }
  });
});

describe('panning and zooming', () => {
  const camera = createLogCamera(0, 20);

  it('pans by whole decades', () => {
    expect(panLogByPixels(camera, 20).centerLog10).toBeCloseTo(-1, 9);
    expect(panLogByPixels(camera, -40).centerLog10).toBeCloseTo(2, 9);
  });

  it('keeps the anchor under the cursor when zooming', () => {
    const anchorX = 250;
    const before = log10FromAtlasX(camera, anchorX, viewport);
    const zoomed = zoomLogAt(camera, 2, anchorX, viewport);

    expect(zoomed.pixelsPerDecade).toBeCloseTo(40, 9);
    expect(log10FromAtlasX(zoomed, anchorX, viewport)).toBeCloseTo(before, 9);
  });

  it('clamps the zoom range', () => {
    let zoomed = camera;
    for (let i = 0; i < 40; i += 1) zoomed = zoomLogAt(zoomed, 2, 500, viewport);
    expect(zoomed.pixelsPerDecade).toBe(MAX_PIXELS_PER_DECADE);

    for (let i = 0; i < 80; i += 1) zoomed = zoomLogAt(zoomed, 0.5, 500, viewport);
    expect(zoomed.pixelsPerDecade).toBe(MIN_PIXELS_PER_DECADE);
  });
});

describe('framing', () => {
  it('fits the whole catalog range into the viewport', () => {
    const camera = frameDecades(-35, 27, viewport);
    const { min, max } = visibleDecades(camera, viewport);
    expect(min).toBeLessThan(-35);
    expect(max).toBeGreaterThan(27);
    expect(camera.centerLog10).toBeCloseTo(-4, 9);
  });

  it('does not blow up on a zero-width span', () => {
    const camera = frameDecades(3, 3, viewport);
    expect(Number.isFinite(camera.pixelsPerDecade)).toBe(true);
    expect(camera.pixelsPerDecade).toBeLessThanOrEqual(MAX_PIXELS_PER_DECADE);
  });
});

describe('the decade axis', () => {
  it('labels engineering boundaries with SI prefixes', () => {
    expect(decadeLabel(0)).toBe('m');
    expect(decadeLabel(-3)).toBe('mm');
    expect(decadeLabel(-6)).toBe('µm');
    expect(decadeLabel(-9)).toBe('nm');
    expect(decadeLabel(3)).toBe('km');
    expect(decadeLabel(9)).toBe('Gm');
  });

  it('falls back to a power of ten off the engineering boundaries', () => {
    expect(decadeLabel(-4)).toBe('10^-4 m');
    expect(decadeLabel(1)).toBe('10^1 m');
  });

  it('falls back beyond the defined prefixes too', () => {
    // There is no prefix past quetta; inventing one would be worse than this.
    expect(decadeLabel(33)).toBe('10^33 m');
    expect(decadeLabel(-33)).toBe('10^-33 m');
  });

  it('emits one tick per visible decade', () => {
    const camera = createLogCamera(0, 50);
    const ticks = decadeTicks(camera, viewport);
    expect(ticks.map((tick) => tick.exponent)).toEqual([
      -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(ticks.filter((tick) => tick.engineering).map((tick) => tick.exponent)).toEqual([
      -9, -6, -3, 0, 3, 6, 9,
    ]);
  });

  it('drops plain decades once they would smear together', () => {
    const dense = createLogCamera(0, 8);
    const ticks = decadeTicks(dense, viewport);
    expect(ticks.every((tick) => tick.engineering)).toBe(true);
    expect(ticks.length).toBeGreaterThan(5);
  });

  it('refuses to emit an unreadable number of ticks', () => {
    expect(decadeTicks(createLogCamera(0, 0.001), viewport)).toEqual([]);
  });

  it('positions ticks consistently with the objects beside them', () => {
    const camera = createLogCamera(-3, 40);
    const ticks = decadeTicks(camera, viewport);
    const millimetreTick = ticks.find((tick) => tick.exponent === -3);
    expect(millimetreTick?.x).toBeCloseTo(atlasX(camera, fromUnit(ONE, 'mm').value, viewport), 9);
  });
});

describe('real catalog magnitudes', () => {
  it('separates a red blood cell from a millimetre by the right distance', () => {
    const camera = createLogCamera(-4, 100);
    const cell = fromUnit(parseDecimalExact('7.5'), 'µm').value;
    const millimetre = fromUnit(ONE, 'mm').value;

    // log10(1e-3) - log10(7.5e-6) = 2.125 decades.
    const gap = atlasX(camera, millimetre, viewport) - atlasX(camera, cell, viewport);
    expect(gap).toBeCloseTo(212.5, 1);
  });
});
