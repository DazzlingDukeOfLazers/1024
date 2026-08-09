import { describe, expect, it } from 'vitest';
import { SCENARIOS, SCENARIO_NAMES } from './scenario';
import {
  ACCUMULATE_THEN_SCALE,
  DIVIDE_AND_RESTORE,
  THIRDS_AND_BACK,
  WORKLOADS,
  runWorkload,
} from './workload';
import { ZERO, abs, add, equals, gt, isZero } from '../rational/rational';
import { WideError } from './digits';

describe('the same workload under four contracts (§14)', () => {
  it('runs every workload under every scenario that does not refuse', () => {
    for (const workload of WORKLOADS) {
      for (const name of SCENARIO_NAMES) {
        if (name === 'strict') continue; // asserted separately: it is meant to throw
        const run = runWorkload(workload, SCENARIOS[name]);
        expect(run.scenario, `${workload.id} under ${name}`).toBe(name);
        expect(run.workload).toBe(workload.id);
      }
    }
  });

  it('gets different answers from the same arithmetic', () => {
    // The whole reason §14 exists. If every policy agreed there would be nothing
    // to measure and nothing to choose between.
    const rounded = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round);
    const truncated = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate);
    expect(equals(rounded.divergence, truncated.divergence)).toBe(false);
  });
});

describe('preserve everything means the information is deferred, not destroyed', () => {
  it('accounts for every bit it narrowed away', () => {
    // The conservation law that makes "return the leftovers" more than a slogan:
    // what the register holds, plus what was carried, is exactly what the
    // arithmetic said — with no rounding anywhere in the sum.
    for (const workload of WORKLOADS) {
      const run = runWorkload(workload, SCENARIOS.preserve);
      expect(
        equals(add(run.value, run.carriedResidue), run.exact),
        `${workload.id}: value + residue should equal the exact result`,
      ).toBe(true);
    }
  });

  it('still diverges on its own, which is why the residue is worth keeping', () => {
    const run = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.preserve);
    expect(isZero(run.divergence)).toBe(false);
    expect(isZero(run.carriedResidue)).toBe(false);
    // And the two are exactly opposite, which is the same statement twice.
    expect(equals(run.divergence, ZERO)).toBe(false);
    expect(equals(add(run.divergence, run.carriedResidue), ZERO)).toBe(true);
  });
});

describe('discarding the residue is where the drift comes from', () => {
  it('drifts further under truncation than under rounding', () => {
    // Truncation is biased: it always loses in the same direction, and over ten
    // steps that accumulates. Rounding to nearest is not, so it does not.
    const rounded = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round);
    const truncated = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate);
    expect(gt(abs(truncated.divergence), abs(rounded.divergence))).toBe(true);
  });

  it('loses exactly what it declined to carry', () => {
    // Same rounding rule, same arithmetic; the only difference is whether the
    // residue was kept. So the difference in the answer is the residue.
    const kept = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.preserve);
    const dropped = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate);
    expect(equals(kept.value, dropped.value)).toBe(true);
    expect(isZero(dropped.carriedResidue)).toBe(true);
    expect(isZero(kept.carriedResidue)).toBe(false);
  });

  it('does not part company on thirds, and that is the divisor talking', () => {
    // One third's expansion never puts the dropped bits past halfway, so nearest
    // and truncate agree bit for bit. Kept as a test because a rounding-policy
    // comparison run on this workload would measure nothing while looking like
    // it had measured something.
    const rounded = runWorkload(THIRDS_AND_BACK, SCENARIOS.round);
    const truncated = runWorkload(THIRDS_AND_BACK, SCENARIOS.truncate);
    expect(equals(rounded.value, truncated.value)).toBe(true);

    // And on sevens they differ, which is what makes the comparison above
    // evidence about the divisor rather than about the policies.
    expect(
      equals(
        runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round).value,
        runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate).value,
      ),
    ).toBe(false);
  });

  it('reports how many steps were inexact', () => {
    const run = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate);
    expect(run.inexactSteps).toBeGreaterThan(0);
    expect(run.inexactSteps).toBeLessThanOrEqual(DIVIDE_AND_RESTORE.steps.length);
  });
});

describe('trapping on inexactness refuses rather than drifting', () => {
  it('throws on a workload that cannot be done exactly', () => {
    // §8 EXACT_REQUIRED, at the scale of a whole run. Dividing by three does not
    // terminate in binary, so this scenario declines the workload instead of
    // returning a number that is not the answer.
    expect(() => runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.strict)).toThrow(WideError);
  });

  it('completes a workload that happens to be exact', () => {
    const exactWorkload = {
      id: 'halving',
      label: 'Divide by two four times',
      initial: DIVIDE_AND_RESTORE.initial,
      steps: [
        { op: 'div', operand: 2n },
        { op: 'div', operand: 2n },
        { op: 'mul', operand: 4n },
      ],
    } as const;
    const run = runWorkload(exactWorkload, SCENARIOS.strict);
    expect(isZero(run.divergence)).toBe(true);
    expect(run.inexactSteps).toBe(0);
  });
});

describe('same-scale addition is exact, so accumulation does not drift (§5)', () => {
  it('adds a thousand times with nothing lost', () => {
    // §5: "exact if the result fits". The only inexact step in this workload is
    // the division at the end, and every policy agrees up to that point.
    const run = runWorkload(ACCUMULATE_THEN_SCALE, SCENARIOS.preserve);
    expect(equals(add(run.value, run.carriedResidue), run.exact)).toBe(true);
    expect(run.inexactSteps).toBeLessThanOrEqual(1);
  });

  it('is the same under every policy until something is narrowed', () => {
    const additionOnly = {
      id: 'addition-only',
      label: 'Add one a hundred times',
      initial: ZERO,
      steps: Array.from({ length: 100 }, () => ({ op: 'add', operand: 1n }) as const),
    };
    const runs = SCENARIO_NAMES.map((name) => runWorkload(additionOnly, SCENARIOS[name]));
    for (const run of runs) {
      expect(isZero(run.divergence), run.scenario).toBe(true);
      expect(run.inexactSteps, run.scenario).toBe(0);
    }
  });
});

describe('the work is measured as well as the answer (§20)', () => {
  it('counts partial products and quotient digits across the run', () => {
    const run = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round);
    expect(run.totals.partialProductsExecuted).toBeGreaterThan(0);
    expect(run.totals.quotientDigitsGenerated).toBeGreaterThan(0);
    expect(run.totals.modeledCycles).toBeGreaterThan(0);
  });

  it('shows skipping doing something on values that are mostly zero', () => {
    const run = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round);
    expect(run.totals.partialProductsSkipped).toBeGreaterThan(run.totals.partialProductsExecuted);
  });

  it('does the same work whatever the narrowing policy, which is the point', () => {
    // Policies change the answer, not the arithmetic. If they changed the work
    // too, a comparison of divergence between them would be confounded.
    const rounded = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.round);
    const truncated = runWorkload(DIVIDE_AND_RESTORE, SCENARIOS.truncate);
    expect(truncated.totals.partialProductsExecuted).toBe(rounded.totals.partialProductsExecuted);
  });
});

describe('a workload has to start somewhere the format can hold', () => {
  it('refuses a starting value that would need rounding before the run began', () => {
    expect(() =>
      runWorkload(
        { id: 'x', label: 'x', initial: { numerator: 1n, denominator: 3n }, steps: [] },
        SCENARIOS.round,
      ),
    ).toThrow(/hold exactly/);
  });
});
