import { describe, expect, it } from 'vitest';
import { MINIMUM_POINTS, driftChart, driftRuns } from './drift';
import { type Rational, ZERO, neg } from '../../core/rational/rational';
import { parseRationalExact } from '../../core/rational/parse';

const at = (literal: string): Rational => parseRationalExact(literal);

/** The Planck grid's real series over a million millimetres, six decades wide. */
const PLANCK = ['-4.054e-37', '-4.054e-36', '-4.055e-33', '-4.054e-31'].map(at);

/**
 * binary64's real series over the same run, at the checkpoints where its signed
 * error crosses zero. Measured, not invented: the run is in the git log.
 */
const BINARY64 = ['6.661e-16', '-1.030e-13', '1.134e-10', '-4.912e-9'].map(at);

describe('drift chart', () => {
  it('places magnitudes on a logarithmic axis', () => {
    const chart = driftChart([{ id: 'planck', label: 'Planck', divergences: PLANCK }])!;

    // Six decades of growth, and the first point is not at the bottom of a
    // linear axis pinned by the last — which is the chart this replaces.
    expect(chart.minLog10).toBeCloseTo(-36.39, 1);
    expect(chart.maxLog10).toBeCloseTo(-30.39, 1);

    const ys = chart.series[0]!.points.map((point) => point.y!);
    expect(ys[0]).toBeCloseTo(0, 9);
    expect(ys.at(-1)).toBeCloseTo(1, 9);
    // The middle points are spread across the height rather than crushed at 0,
    // which is what a linear axis over six decades would have done: 4 × 10^-37
    // is a ten-thousandth of one percent of 4 × 10^-31.
    expect(ys[1]!).toBeGreaterThan(0.1);
    expect(ys[2]!).toBeLessThan(0.9);
  });

  it('keeps the sign, which a magnitude chart would erase', () => {
    const chart = driftChart([{ id: 'b64', label: 'binary64', divergences: BINARY64 }])!;
    const series = chart.series[0]!;

    expect(series.points.map((point) => point.sign)).toEqual([1, -1, 1, -1]);
    expect(series.signChanges).toBe(3);
    // And the magnitudes still climb, which is the other half of the story.
    const ys = series.points.map((point) => point.y!);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
  });

  it('draws each row at its own scale, so a fine machine still has a shape', () => {
    const chart = driftChart([
      { id: 'planck', label: 'Planck', divergences: PLANCK },
      { id: 'b64', label: 'binary64', divergences: BINARY64 },
    ])!;

    // Twenty-odd decades apart. Written the obvious way, with one shared axis,
    // the Planck row spanned 6 of those 22 and binary64 8, and both rendered as
    // horizontal lines. The screenshot is what settled it.
    expect(chart.maxLog10 - chart.minLog10).toBeGreaterThan(20);

    for (const series of chart.series) {
      const ys = series.points.map((point) => point.y!);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...ys)).toBeCloseTo(1, 9);
    }
  });

  it('states the distance between machines instead of drawing it', () => {
    // The Timeline above prints every divergence, so the comparison is already
    // there in numbers — which work across twenty-two decades where pixels do
    // not. The chart still reports the overall extent for the caption to say.
    const chart = driftChart([
      { id: 'planck', label: 'Planck', divergences: PLANCK },
      { id: 'b64', label: 'binary64', divergences: BINARY64 },
    ])!;

    expect(chart.minLog10).toBeCloseTo(-36.39, 1);
    expect(chart.maxLog10).toBeCloseTo(-8.31, 1);
    // And it is not any single row's range.
    expect(chart.minLog10).toBeLessThan(chart.series[1]!.minLog10!);
    expect(chart.maxLog10).toBeGreaterThan(chart.series[0]!.maxLog10!);
  });

  it('gives exact zero no position at all', () => {
    const chart = driftChart([
      { id: 'm', label: 'm', divergences: [ZERO, at('1e-39'), at('2e-39'), ZERO] },
    ])!;
    const points = chart.series[0]!.points;

    // log 0 is not a very small number. It is a different answer.
    expect(points[0]!.y).toBeUndefined();
    expect(points[0]!.log10).toBeUndefined();
    expect(points[0]!.sign).toBe(0);
    expect(points[1]!.y).toBeDefined();
    expect(points.at(-1)!.y).toBeUndefined();
  });

  it('breaks the line at an exact checkpoint rather than drawing across it', () => {
    const chart = driftChart([
      { id: 'm', label: 'm', divergences: [at('1e-39'), ZERO, at('2e-39'), at('3e-39')] },
    ])!;
    const runs = driftRuns(chart.series[0]!);

    expect(runs.map((run) => run.map((point) => point.index))).toEqual([[0], [2, 3]]);
  });

  it('reports each machine`s own extent beside the shared one', () => {
    const chart = driftChart([
      { id: 'planck', label: 'Planck', divergences: PLANCK },
      { id: 'b64', label: 'binary64', divergences: BINARY64 },
    ])!;

    // A row has to be able to say what it is showing; the shared axis alone
    // would leave a squashed line unlabelled.
    expect(chart.series[0]!.maxLog10).toBeCloseTo(-30.39, 1);
    expect(chart.series[1]!.maxLog10).toBeCloseTo(-8.31, 1);
    expect(chart.series[0]!.alwaysExact).toBe(false);
  });

  it('says a machine was exact throughout rather than drawing it at a floor', () => {
    const chart = driftChart([
      { id: 'exact', label: 'exact', divergences: [ZERO, ZERO, ZERO] },
      { id: 'other', label: 'other', divergences: [at('1e-9'), at('2e-9'), at('3e-9')] },
    ])!;

    expect(chart.series[0]!.alwaysExact).toBe(true);
    expect(chart.series[0]!.minLog10).toBeUndefined();
    expect(chart.series[0]!.points.every((point) => point.y === undefined)).toBe(true);
    expect(chart.series[1]!.alwaysExact).toBe(false);
  });

  it('refuses to draw a shape a run does not have', () => {
    // Four of the six built-in experiments keep two checkpoints. Two points is
    // a straight segment whatever the data did in between, and a chart that
    // cannot be wrong is not evidence.
    expect(MINIMUM_POINTS).toBe(3);
    expect(
      driftChart([{ id: 'm', label: 'm', divergences: [at('1e-9'), at('2e-9')] }]),
    ).toBeUndefined();

    // Nor when nothing ever diverged: a flat line at an invented floor claims a
    // magnitude, and the honest answer is that there is no magnitude.
    expect(
      driftChart([{ id: 'm', label: 'm', divergences: [ZERO, ZERO, ZERO, ZERO] }]),
    ).toBeUndefined();

    expect(driftChart([])).toBeUndefined();
  });

  it('puts a flat series half way up rather than on the floor', () => {
    // A zero-height range would otherwise be 0/0 — and pinning it to the bottom
    // would say "smallest on the chart", which is a claim about a row that has
    // no top and no bottom.
    const chart = driftChart([
      { id: 'm', label: 'm', divergences: [at('1e-9'), neg(at('1e-9')), at('1e-9')] },
    ])!;
    for (const point of chart.series[0]!.points) {
      expect(point.y).toBe(0.5);
    }
    expect(chart.series[0]!.signChanges).toBe(2);
  });

  it('falls back to checkpoint position when there are no iterations to plot against', () => {
    const chart = driftChart([
      { id: 'm', label: 'm', divergences: [at('1e-9'), at('2e-9'), at('3e-9'), at('4e-9')] },
    ])!;
    expect(chart.xAxis).toBe('checkpoint');
    expect(chart.series[0]!.points.map((point) => point.x)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(chart.pointCount).toBe(4);
  });
});

describe('what across means', () => {
  /**
   * The real million-millimetre trace, trimmed. Divergence is exactly
   * proportional to the iteration count — every addition adds one quantization
   * error of the same sign — which is the fact the chart should show and the
   * first version of it did not.
   */
  const ITERATIONS = [undefined, 1, 10, 100, 1000, 10_000, 100_000, 1_000_000];
  const PROPORTIONAL = [
    ZERO,
    at('-4.054e-37'),
    at('-4.054e-36'),
    at('-4.054e-35'),
    at('-4.054e-34'),
    at('-4.054e-33'),
    at('-4.054e-32'),
    at('-4.054e-31'),
  ];

  it('plots against log iterations when the run has them', () => {
    const chart = driftChart([{ id: 'm', label: 'm', divergences: PROPORTIONAL }], ITERATIONS)!;
    expect(chart.xAxis).toBe('iterations');
    expect(chart.minIteration).toBe(1);
    expect(chart.maxIteration).toBe(1_000_000);
  });

  it('draws proportional drift as a straight line, which is the whole point', () => {
    // On checkpoint position this same data is a curve — an artefact of
    // sampling at 1, 10, 100 … rather than anything the arithmetic did. On log
    // iterations it is a line of slope 1, and the line is a measurement: the
    // error grows in exact proportion to the number of additions.
    const chart = driftChart([{ id: 'm', label: 'm', divergences: PROPORTIONAL }], ITERATIONS)!;
    const drawn = chart.series[0]!.points.filter(
      (point) => point.x !== undefined && point.y !== undefined,
    );
    expect(drawn.length).toBe(7);

    for (let i = 1; i < drawn.length; i += 1) {
      const slope = (drawn[i]!.y! - drawn[i - 1]!.y!) / (drawn[i]!.x! - drawn[i - 1]!.x!);
      expect(slope, `segment ${i}`).toBeCloseTo(1, 6);
    }
  });

  it('leaves the checkpoint taken before the run off the axis', () => {
    // Iteration 0 has no position on a log axis, the same way exact zero has
    // none on the vertical one. Pushing it to the left edge would say it
    // happened at iteration 1.
    const chart = driftChart([{ id: 'm', label: 'm', divergences: PROPORTIONAL }], ITERATIONS)!;
    const first = chart.series[0]!.points[0]!;
    expect(first.x).toBeUndefined();
    expect(first.y).toBeUndefined();
    expect(chart.series[0]!.points[1]!.x).toBe(0);
  });

  it('breaks the line at a point with no horizontal position too', () => {
    const chart = driftChart([{ id: 'm', label: 'm', divergences: PROPORTIONAL }], ITERATIONS)!;
    const runs = driftRuns(chart.series[0]!);
    // One run, starting after the off-axis checkpoint — not a segment reaching
    // back to a point that is not there.
    expect(runs).toHaveLength(1);
    expect(runs[0]!.map((point) => point.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('breaks the line for a checkpoint that has a divergence but no iteration', () => {
    // The case the test above cannot reach: there the pre-run sample is off
    // *both* axes, so breaking on y alone would look correct. An atomic step
    // between repeats has a real divergence and still no iteration number, and
    // without the x guard its missing coordinate reaches the polyline as NaN.
    const chart = driftChart(
      [
        {
          id: 'm',
          label: 'm',
          divergences: [at('-1e-38'), at('-1e-37'), at('-1e-35'), at('-1e-33')],
        },
      ],
      [undefined, 1, 100, 10_000],
    )!;
    const points = chart.series[0]!.points;
    expect(points[0]!.y).toBeDefined();
    expect(points[0]!.x).toBeUndefined();

    expect(driftRuns(chart.series[0]!).map((run) => run.map((point) => point.index))).toEqual([
      [1, 2, 3],
    ]);
  });

  it('refuses a log axis that would not span a decade', () => {
    // Iterations 1 to 5 on a log axis is most of the width for the first two
    // steps. Checkpoint position is the better picture there, and the caption
    // says which one it drew.
    const near = driftChart(
      [{ id: 'm', label: 'm', divergences: [at('1e-9'), at('2e-9'), at('3e-9'), at('4e-9')] }],
      [1, 2, 3, 4],
    )!;
    expect(near.xAxis).toBe('checkpoint');
    expect(near.series[0]!.points.every((point) => point.x !== undefined)).toBe(true);
  });

  it('refuses a log axis with too few points on it', () => {
    // Three checkpoints of which one is the pre-run sample leaves two, and two
    // points are a straight line whatever the run did.
    const sparse = driftChart(
      [{ id: 'm', label: 'm', divergences: [ZERO, at('1e-9'), at('1e-6')] }],
      [undefined, 1, 1000],
    )!;
    expect(sparse.xAxis).toBe('checkpoint');
  });
});
