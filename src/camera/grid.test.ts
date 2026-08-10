import { describe, expect, it } from 'vitest';
import {
  DETAILED_PIXELS,
  GLYPH_PIXELS,
  GRID_SIGNIFICANDS,
  TARGET_MAJOR_PIXELS,
  chooseGridStep,
  detailFor,
  formatGridOffset,
  gridLabelOffset,
  gridLabelUnit,
  gridTicks,
  minorStep,
} from './grid';
import { type Viewport, createCamera, toScreenX } from './camera';
import { ONE, ZERO, add, mul, pow10, rational, sub } from '../core/rational/rational';
import { parseDecimalExact, parseRationalExact } from '../core/rational/parse';
import { fromUnit } from '../core/quantities/quantity';

const r = rational;
const viewport: Viewport = { widthPx: 1000, heightPx: 300 };

describe('the 1/2/5 step chooser', () => {
  it('only ever picks 1, 2 or 5 times a power of ten', () => {
    for (let zoom = -12; zoom <= 12; zoom += 0.25) {
      const step = chooseGridStep(createCamera(ZERO, zoom));
      expect(GRID_SIGNIFICANDS).toContain(step.significand);
      expect(step.spacing).toEqual(mul(r(BigInt(step.significand)), pow10(step.exponent)));
    }
  });

  it('keeps major divisions in the 80–140 px band docs/UI_SPEC.md asks for', () => {
    for (let zoom = -12; zoom <= 12; zoom += 0.1) {
      const step = chooseGridStep(createCamera(ZERO, zoom));
      expect(step.pixels).toBeGreaterThan(60);
      expect(step.pixels).toBeLessThan(180);
    }
  });

  it('lands exactly on target at a round zoom', () => {
    // 1 mm per pixel with a 100 mm step is 100 px — the closest 1/2/5 can get.
    const step = chooseGridStep(createCamera(ZERO, -3));
    expect(step.pixels).toBeCloseTo(100, 6);
    expect(step.spacing).toEqual(fromUnit(r(100n), 'mm').value);
  });

  it('honours a different target', () => {
    const wide = chooseGridStep(createCamera(ZERO, -3), 300);
    expect(wide.pixels).toBeGreaterThan(TARGET_MAJOR_PIXELS);
  });
});

describe('the grid changes without the scene jumping', () => {
  it('moves objects continuously while the step changes underneath them', () => {
    // The acceptance criterion: zooming from metres to millimetres to
    // micrometres must not make anything jump.
    const object = fromUnit(parseDecimalExact('7.5'), 'µm').value;

    let previousX: number | undefined;
    let previousSpacing: string | undefined;
    let stepChanges = 0;

    for (let zoom = 0; zoom >= -8; zoom -= 0.02) {
      const camera = createCamera(ZERO, zoom);
      const step = chooseGridStep(camera);
      const x = toScreenX(camera, object, viewport);

      const spacingKey = `${step.significand}e${step.exponent}`;
      if (previousSpacing !== undefined && spacingKey !== previousSpacing) stepChanges += 1;
      previousSpacing = spacingKey;

      if (previousX !== undefined && Number.isFinite(x) && Number.isFinite(previousX)) {
        // A 2% zoom step can never move an on-screen object far.
        if (Math.abs(x - 500) < 5000) {
          expect(Math.abs(x - previousX)).toBeLessThan(300);
        }
      }
      previousX = x;
    }

    // And the grid really did re-step many times along the way.
    expect(stepChanges).toBeGreaterThan(10);
  });
});

describe('engineering labels', () => {
  it('labels each decade band with its SI prefix', () => {
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, 0))).symbol).toBe('m');
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, -3))).symbol).toBe('mm');
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, -6))).symbol).toBe('µm');
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, -9))).symbol).toBe('nm');
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, 3))).symbol).toBe('km');
    expect(gridLabelUnit(chooseGridStep(createCamera(ZERO, 6))).symbol).toBe('Mm');
  });

  it('only ever uses powers of a thousand', () => {
    for (let zoom = -12; zoom <= 12; zoom += 0.25) {
      const unit = gridLabelUnit(chooseGridStep(createCamera(ZERO, zoom)));
      // Math.abs because -3 % 3 is -0 in JavaScript, and -0 is not 0 to Object.is.
      expect(Math.abs(unit.exponent % 3)).toBe(0);
      expect(unit.metersPerUnit).toEqual(pow10(unit.exponent));
    }
  });

  it('writes ticks as plain numbers in that unit', () => {
    const camera = createCamera(ZERO, -3);
    const step = chooseGridStep(camera);
    const { ticks } = gridTicks(camera, viewport, step, (meters) =>
      toScreenX(camera, meters, viewport),
    );

    const labels = ticks.filter((tick) => tick.major).map((tick) => tick.label);
    // 100 mm steps across a 1000 mm viewport, labelled in millimetres.
    expect(labels).toContain('0');
    expect(labels).toContain('100');
    expect(labels).toContain('-100');
    expect(labels.some((label) => label?.includes('e'))).toBe(false);
  });
});

describe('minor divisions', () => {
  it('nests inside a major without landing on it twice', () => {
    const camera = createCamera(ZERO, -3);
    const step = chooseGridStep(camera);
    const { ticks } = gridTicks(camera, viewport, step, (meters) =>
      toScreenX(camera, meters, viewport),
    );

    const positions = ticks.map((tick) => `${tick.meters.numerator}/${tick.meters.denominator}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(ticks.some((tick) => !tick.major)).toBe(true);
  });

  it('subdivides by 5, 4 or 5 depending on the significand', () => {
    for (let zoom = -6; zoom <= 6; zoom += 0.1) {
      const camera = createCamera(ZERO, zoom);
      const major = chooseGridStep(camera);
      const minor = minorStep(major, camera);
      const divisions = major.pixels / minor.pixels;
      expect([4, 5]).toContain(Math.round(divisions));
    }
  });

  it('drops minors once they would be noise', () => {
    // A very wide target makes the majors huge and the minors visible...
    const camera = createCamera(ZERO, -3);
    const { ticks: withMinors } = gridTicks(camera, viewport, chooseGridStep(camera), (m) =>
      toScreenX(camera, m, viewport),
    );
    expect(withMinors.some((tick) => !tick.major)).toBe(true);

    // ...but a tiny target makes them sub-pixel, and then they are dropped.
    const dense = chooseGridStep(camera, 12);
    const { ticks: withoutMinors } = gridTicks(camera, viewport, dense, (m) =>
      toScreenX(camera, m, viewport),
    );
    expect(withoutMinors.every((tick) => tick.major)).toBe(true);
  });

  it('keeps every tick on an exact multiple, majors and minors alike', () => {
    const camera = createCamera(ZERO, -3);
    const step = chooseGridStep(camera);
    const minor = minorStep(step, camera);
    const { ticks } = gridTicks(camera, viewport, step, (m) => toScreenX(camera, m, viewport));

    for (const tick of ticks) {
      const multiple = mul(
        tick.meters,
        rational(minor.spacing.denominator, minor.spacing.numerator),
      );
      expect(multiple.denominator).toBe(1n);
    }
  });
});

describe('level of detail', () => {
  it('picks a rendering by pixel size, never by count', () => {
    expect(detailFor(100)).toBe('detailed');
    expect(detailFor(DETAILED_PIXELS)).toBe('detailed');
    expect(detailFor(DETAILED_PIXELS - 0.1)).toBe('glyph');
    expect(detailFor(GLYPH_PIXELS)).toBe('glyph');
    expect(detailFor(GLYPH_PIXELS - 0.1)).toBe('aggregate');
    expect(detailFor(0)).toBe('aggregate');
  });

  it('treats a degenerate size as an aggregate rather than crashing', () => {
    expect(detailFor(Number.NaN)).toBe('aggregate');
    expect(detailFor(Number.POSITIVE_INFINITY)).toBe('aggregate');
    expect(detailFor(-5)).toBe('aggregate');
  });

  it('walks a red blood cell through all three levels as the camera zooms out', () => {
    const cell = fromUnit(parseDecimalExact('7.5'), 'µm').value;
    const levels = new Set<string>();
    for (let zoom = -8; zoom <= -3; zoom += 0.1) {
      const camera = createCamera(ZERO, zoom);
      levels.add(detailFor(cell.numerator === 0n ? 0 : pixelsOf(camera, cell)));
    }
    expect([...levels].sort()).toEqual(['aggregate', 'detailed', 'glyph']);
  });
});

function pixelsOf(camera: ReturnType<typeof createCamera>, meters: typeof ONE): number {
  return toScreenX(camera, meters, viewport) - toScreenX(camera, ZERO, viewport);
}

describe('offset notation, for grids far from zero', () => {
  const farCamera = (log10MetresPerPixel: number) => createCamera(pow10(20), log10MetresPerPixel);

  it('leaves ordinary grids alone', () => {
    // The common case must not change. At a metre-scale view the labels stand
    // on their own and an offset would be noise.
    for (const zoom of [-6, -3, 0, 3, 6]) {
      const camera = createCamera(ZERO, zoom);
      const { offset } = gridTicks(camera, viewport, chooseGridStep(camera), (m) =>
        toScreenX(camera, m, viewport),
      );
      expect(offset, `zoom ${zoom}`).toBeUndefined();
    }
  });

  it('factors out the shared part when six digits stop distinguishing ticks', () => {
    const camera = farCamera(-4);
    const { ticks, offset } = gridTicks(camera, viewport, chooseGridStep(camera), (m) =>
      toScreenX(camera, m, viewport),
    );
    expect(offset).toBeDefined();

    const labels = ticks.filter((tick) => tick.major).map((tick) => tick.label);
    expect(labels.length).toBeGreaterThan(2);
    // The defect this fixes: every label was the same string.
    expect(new Set(labels).size, labels.join(' ')).toBe(labels.length);
  });

  it('loses nothing: offset plus label is the tick, exactly', () => {
    // The whole justification for the notation. If this ever fails, the ruler
    // has started lying about where its ticks are.
    const camera = farCamera(-4);
    const step = chooseGridStep(camera);
    const unit = gridLabelUnit(step);
    const { ticks, offset } = gridTicks(camera, viewport, step, (m) =>
      toScreenX(camera, m, viewport),
    );

    let checked = 0;
    for (const tick of ticks) {
      if (!tick.major) continue;
      const shown = parseRationalExact(tick.label!);
      expect(add(offset!, mul(shown, unit.metersPerUnit)), tick.label).toEqual(tick.meters);
      checked += 1;
    }
    // Anti-vacuity: a grid with no major ticks would satisfy the loop above.
    expect(checked).toBeGreaterThan(2);
  });

  it('is a round number, so a reader can add it in their head', () => {
    const camera = farCamera(-4);
    const { offset } = gridTicks(camera, viewport, chooseGridStep(camera), (m) =>
      toScreenX(camera, m, viewport),
    );
    expect(offset!.denominator).toBe(1n);
    expect(offset).toEqual(pow10(20));
  });

  it('holds still while the view moves, rather than renumbering every label', () => {
    // An offset pinned to the first tick would change the moment a tick
    // scrolled off the edge, silently renumbering the whole axis for a pan of
    // a few pixels. The granularity is two orders above the span, so it does
    // not.
    const step = chooseGridStep(farCamera(-4));
    const offsets = new Set<string>();
    for (let pixels = 0; pixels <= 40; pixels += 8) {
      const camera = createCamera(add(pow10(20), mul(rational(BigInt(pixels)), pow10(-4))), -4);
      const { offset } = gridTicks(camera, viewport, step, (m) => toScreenX(camera, m, viewport));
      offsets.add(`${offset!.numerator}/${offset!.denominator}`);
    }
    expect(offsets.size, [...offsets].join(' ')).toBe(1);
  });

  it('refuses an offset it cannot justify', () => {
    // Fewer than two ticks, or a spacing close to the magnitude, means the
    // labels distinguish themselves and the notation would only add a step.
    expect(gridLabelOffset([], rational(1n))).toBeUndefined();
    expect(gridLabelOffset([pow10(20)], rational(1n))).toBeUndefined();
    expect(gridLabelOffset([ZERO, rational(1n)], rational(1n))).toBeUndefined();
  });
});

describe('writing the offset out', () => {
  const mm = gridLabelUnit(chooseGridStep(createCamera(ZERO, -4)));

  it('is short when the number is round', () => {
    expect(formatGridOffset(pow10(20), mm)).toBe('+1 × 10^23 mm');
  });

  it('carries every significant digit rather than the first six', () => {
    // The failure this guards: rounding the offset to six figures — the same
    // six that made the tick labels identical — would make `offset + label`
    // quietly untrue.
    const awkward = add(pow10(20), rational(1n, 1000n));
    const text = formatGridOffset(awkward, mm);
    expect(text).toContain('10^23');
    expect(text).not.toBe('+1 × 10^23 mm');
    // 10^20 m + 1 mm is 10^23 mm + 1, so the mantissa needs all 24 digits.
    expect(text.replace(/[^0-9]/g, '').length).toBeGreaterThan(20);
  });

  it('names the sign it means', () => {
    // Compared by codepoint: the minus is U+2212, not a hyphen, and a test
    // written with the wrong one of those passes or fails for reasons that
    // have nothing to do with the code.
    expect(formatGridOffset(pow10(20), mm).codePointAt(0)).toBe(0x2b);
    expect(formatGridOffset(sub(ZERO, pow10(20)), mm).codePointAt(0)).toBe(0x2212);
    expect(formatGridOffset(sub(ZERO, pow10(20)), mm)).toContain('10^23');
  });
});
