import { describe, expect, it } from 'vitest';
import { buildDisagreementView, drawnSeparationPixels } from './disagreement';
import { type Viewport, metersPerPixel } from '../../camera/camera';
import {
  ONE,
  ZERO,
  abs,
  add,
  div,
  equals,
  gt,
  lt,
  mul,
  rational,
  sub,
} from '../../core/rational/rational';
import { orderOfMagnitude10 } from '../../core/rational/log10';
import { parseDecimalExact } from '../../core/rational/parse';
import { runExperiment } from '../../core/experiments/runner';
import { requireExperiment } from '../../core/experiments/fixtures';

const r = rational;
const viewport: Viewport = { widthPx: 800, heightPx: 120 };

function readingsFrom(result: ReturnType<typeof runExperiment>) {
  return result.machines.map((machine) => ({
    id: machine.id,
    label: machine.label,
    decoded: machine.final.decoded,
  }));
}

describe('when every machine agrees', () => {
  const view = buildDisagreementView(
    ONE,
    [
      { id: 'a', label: 'A', decoded: ONE },
      { id: 'b', label: 'B', decoded: ONE },
    ],
    viewport,
    true,
  );

  it('says so, and does not magnify anything', () => {
    expect(view.agreed).toBe(true);
    expect(view.maxDivergence).toEqual(ZERO);
    expect(view.magnification).toEqual(ONE);
    expect(view.magnified).toBe(false);
  });

  it('refuses to zoom, because there is nothing to zoom into', () => {
    expect(view.camera).toEqual(view.naturalCamera);
    expect(drawnSeparationPixels(view)).toBe(0);
  });
});

describe('a million millimetres', () => {
  const result = runExperiment(requireExperiment('million-millimeters'));
  const readings = readingsFrom(result);
  const natural = buildDisagreementView(result.exactFinal, readings, viewport, false);
  const zoomed = buildDisagreementView(result.exactFinal, readings, viewport, true);

  it('draws every machine on top of the exact value at true scale', () => {
    // PROJECT_SPEC §8: they start indistinguishable, because the error really
    // is that small next to 1000 m.
    expect(natural.magnified).toBe(false);
    expect(natural.magnification).toEqual(ONE);
    expect(drawnSeparationPixels(natural)).toBeLessThan(1);
    for (const point of natural.points) {
      expect(Math.abs(point.x! - natural.exactX)).toBeLessThan(1);
    }
  });

  it('separates them visibly once zoomed', () => {
    expect(zoomed.agreed).toBe(false);
    expect(drawnSeparationPixels(zoomed)).toBeGreaterThan(100);
  });

  it('discloses an enormous magnification, because it is enormous', () => {
    expect(zoomed.magnified).toBe(true);

    // The magnification is essentially the ratio of the value to its error —
    // 1000 m of context against a divergence many decades smaller. Asserting
    // the relationship rather than a hard-coded decade keeps the test honest if
    // the framing constants change.
    const ratio = div(abs(result.exactFinal), zoomed.maxDivergence);
    expect(
      Math.abs(orderOfMagnitude10(zoomed.magnification) - orderOfMagnitude10(ratio)),
    ).toBeLessThanOrEqual(1);
    expect(orderOfMagnitude10(zoomed.magnification)).toBeGreaterThan(8);
  });

  it('reports a magnification that describes the picture actually drawn', () => {
    // Not the intended zoom — the ratio of the two cameras in hand.
    const expected = div(metersPerPixel(zoomed.naturalCamera), metersPerPixel(zoomed.camera));
    expect(zoomed.magnification).toEqual(expected);
  });

  it('keeps binary64 the outlier and fixed point closer in', () => {
    const divergenceOf = (id: string) =>
      abs(zoomed.points.find((point) => point.id === id)!.divergence!);
    expect(gt(divergenceOf('binary64'), divergenceOf('q128.128@m'))).toBe(true);
  });
});

describe('0.1 + 0.2', () => {
  const result = runExperiment(requireExperiment('decimal-0-1-plus-0-2'));
  const zoomed = buildDisagreementView(result.exactFinal, readingsFrom(result), viewport, true);

  it('magnifies by roughly the ratio of the value to its error', () => {
    // 0.3 m against ~1e-17 m of divergence.
    expect(orderOfMagnitude10(zoomed.magnification)).toBeGreaterThan(14);
  });

  it('places the exact reference between the machines that straddle it', () => {
    const withDivergence = zoomed.points.filter((point) => point.divergence !== undefined);
    expect(withDivergence.length).toBeGreaterThan(0);

    // Never on the wrong side. A machine whose divergence is many decades
    // smaller than the widest lands on the same pixel as the reference, which
    // is right: at this zoom its error genuinely is invisible.
    for (const point of withDivergence) {
      if (gt(point.divergence!, ZERO)) expect(point.x!).toBeGreaterThanOrEqual(zoomed.exactX);
      if (lt(point.divergence!, ZERO)) expect(point.x!).toBeLessThanOrEqual(zoomed.exactX);
    }

    // The machine the zoom was chosen for is plainly clear of the reference.
    const widest = withDivergence.reduce((worst, point) =>
      gt(abs(point.divergence!), abs(worst.divergence!)) ? point : worst,
    );
    expect(Math.abs(widest.x! - zoomed.exactX)).toBeGreaterThan(100);
  });
});

describe('the magnification is exact', () => {
  it('is a rational, not a rounded float', () => {
    const view = buildDisagreementView(
      ONE,
      [{ id: 'a', label: 'A', decoded: add(ONE, parseDecimalExact('1e-20')) }],
      viewport,
      true,
    );
    expect(view.magnification.denominator > 0n).toBe(true);
    expect(
      equals(
        view.magnification,
        div(view.magnification.numerator === 0n ? ONE : view.magnification, ONE),
      ),
    ).toBe(true);
  });

  it('is exactly one when nothing is magnified', () => {
    const view = buildDisagreementView(
      ONE,
      [{ id: 'a', label: 'A', decoded: add(ONE, parseDecimalExact('1e-20')) }],
      viewport,
      false,
    );
    expect(view.magnification).toEqual(ONE);
    expect(view.magnified).toBe(false);
  });
});

describe('machines with no rational value', () => {
  it('are marked off-screen rather than placed at a made-up position', () => {
    const view = buildDisagreementView(
      ONE,
      [
        { id: 'finite', label: 'finite', decoded: ONE },
        { id: 'infinite', label: 'infinite', decoded: undefined },
      ],
      viewport,
      true,
    );
    const infinite = view.points.find((point) => point.id === 'infinite')!;
    expect(infinite.x).toBeUndefined();
    expect(infinite.divergence).toBeUndefined();
    expect(infinite.offScreen).toBe(true);
  });
});

describe('degenerate inputs', () => {
  it('handles an exact reference of zero', () => {
    const view = buildDisagreementView(
      ZERO,
      [{ id: 'a', label: 'A', decoded: parseDecimalExact('1e-9') }],
      viewport,
      true,
    );
    expect(Number.isFinite(view.exactX)).toBe(true);
    expect(Number.isFinite(view.points[0]!.x!)).toBe(true);
    expect(view.magnified).toBe(false);
  });

  it('handles everything being zero', () => {
    const view = buildDisagreementView(
      ZERO,
      [{ id: 'a', label: 'A', decoded: ZERO }],
      viewport,
      true,
    );
    expect(view.agreed).toBe(true);
    expect(Number.isFinite(view.exactX)).toBe(true);
  });

  it('handles a single machine', () => {
    const view = buildDisagreementView(
      ONE,
      [{ id: 'a', label: 'A', decoded: sub(ONE, parseDecimalExact('1e-12')) }],
      viewport,
      true,
    );
    expect(drawnSeparationPixels(view)).toBe(0);
    expect(view.magnified).toBe(true);
  });
});

describe('divergence is measured, not assumed', () => {
  it('matches decoded minus exact for every machine', () => {
    const result = runExperiment(requireExperiment('large-offset'));
    const view = buildDisagreementView(result.exactFinal, readingsFrom(result), viewport, true);
    for (const point of view.points) {
      if (point.decoded === undefined) continue;
      expect(point.divergence).toEqual(sub(point.decoded, result.exactFinal));
    }
  });

  it('finds the millimetre binary64 lost', () => {
    const result = runExperiment(requireExperiment('large-offset'));
    const view = buildDisagreementView(result.exactFinal, readingsFrom(result), viewport, true);
    const binary64 = view.points.find((point) => point.id === 'binary64')!;
    expect(binary64.divergence).toEqual(mul(r(-1n), parseDecimalExact('0.001')));
  });
});
