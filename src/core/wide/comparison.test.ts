import { describe, expect, it } from 'vitest';
import {
  ACCUMULATE_TENTHS,
  ACCUMULATE_TENTHS_FAR,
  CANCELLATION,
  COMPARISON_WORKLOADS,
  REPRESENTATIONS,
  compareRepresentations,
} from './comparison';
import { SCENARIOS } from './scenario';
import {
  type Rational,
  ZERO,
  abs,
  div,
  equals,
  gt,
  isZero,
  lt,
  mul,
  pow10,
  rational,
} from '../rational/rational';

const runFor = (workload: (typeof COMPARISON_WORKLOADS)[number]) => {
  const runs = compareRepresentations(workload);
  return new Map(runs.map((run) => [run.representation, run]));
};

describe('every representation runs every workload', () => {
  it('produces a run for each', () => {
    for (const workload of COMPARISON_WORKLOADS) {
      const runs = compareRepresentations(workload);
      expect(runs.map((run) => run.representation)).toEqual([...REPRESENTATIONS]);
    }
  });

  it('holds the exact arm to zero divergence, since it is the reference', () => {
    for (const workload of COMPARISON_WORKLOADS) {
      const exact = runFor(workload).get('exact')!;
      expect(isZero(exact.divergence!), workload.id).toBe(true);
      expect(exact.inexactSteps, workload.id).toBe(0);
    }
  });
});

describe('adding a tenth a thousand times', () => {
  const runs = runFor(ACCUMULATE_TENTHS);

  it('is exact for nobody, because a tenth is not a binary fraction', () => {
    // Worth stating plainly: the wide machine does not escape this. §23 says the
    // architecture changes where error occurs, not whether it does.
    for (const name of ['binary64', 'q128.128', 'wide-fixed-point'] as const) {
      expect(runs.get(name)!.inexactSteps, name).toBeGreaterThan(0);
    }
  });

  it('leaves the fixed-point machines far closer than binary64', () => {
    const float = abs(runs.get('binary64')!.divergence!);
    const wide = abs(runs.get('wide-fixed-point')!.divergence!);
    const q128 = abs(runs.get('q128.128')!.divergence!);
    expect(lt(wide, float)).toBe(true);
    expect(lt(q128, float)).toBe(true);
  });

  it('gives the same answer to a hundred and twenty-eight bits either way', () => {
    // Q128.128 and the wide machine at 128 fraction bits are the same grid, so
    // they had better agree. If they did not, one of the two implementations
    // would be wrong and this comparison would be measuring that instead.
    expect(equals(runs.get('q128.128')!.final!, runs.get('wide-fixed-point')!.final!)).toBe(true);
  });
});

describe('the same accumulation a million metres from zero (§23)', () => {
  const near = runFor(ACCUMULATE_TENTHS);
  const far = runFor(ACCUMULATE_TENTHS_FAR);

  it('does not move the fixed-point machines at all', () => {
    // Constant absolute resolution: the quantum does not know where it is. This
    // is the gain §24 asks to be tested, and it is a measurement rather than a
    // claim.
    for (const name of ['q128.128', 'wide-fixed-point'] as const) {
      const worst = near.get(name)!.worstStepError;
      // Anti-vacuity: "identical" would hold just as well if both were zero, and
      // then this test would be asserting nothing. The step error is real, and
      // it sits inside one quantum of a 128-bit fraction.
      expect(isZero(worst), name).toBe(false);
      expect(lt(worst, div(rational(1n), rational(1n << 128n))), name).toBe(true);
      expect(equals(worst, far.get(name)!.worstStepError), name).toBe(true);
    }
  });

  it('makes binary64 coarser by exactly 2^12', () => {
    // Magnitude-dependent spacing, which is the cost side of the same trade.
    //
    // The factor is worth being exact about, because the obvious guess is wrong.
    // Counting decades suggests six decades of magnitude buy about 10^6 of
    // coarseness. binary64 does not work in decades: its quantum doubles once
    // per binade, and the two runs finish 12 binades apart — the near run at
    // 100, in [2^6, 2^7), and the far run at 1000100, in [2^19, 2^20). So the
    // coarsening is 2^12 = 4096, and it is exact rather than approximate.
    const nearFloat = near.get('binary64')!.worstStepError;
    const farFloat = far.get('binary64')!.worstStepError;
    expect(equals(farFloat, mul(nearFloat, rational(4096n)))).toBe(true);
  });

  it('leaves binary64 with a worse relative error far from zero as well', () => {
    // The stronger statement, since a bigger number can afford a bigger absolute
    // error: relative to the answer, binary64 does worse out here too.
    const nearRelative = near.get('binary64')!.relativeError!;
    const farRelative = far.get('binary64')!.relativeError!;
    expect(gt(farRelative, nearRelative)).toBe(true);
  });
});

describe("the wide machine's fraction width is its grid", () => {
  // This exists because of a surviving mutant. Narrowing the wide machine from
  // 128 fraction bits to 127 changed nothing in any test above, which looked
  // like the width being ignored and is not.
  //
  // A tenth is one of the operands where the two grids coincide: 2^126/5 has
  // fractional part .8 and 2^127/5 has .6, so both round up and the 128-bit
  // answer is exactly twice the 127-bit one. The whole accumulation inherits it.
  // The coincidence is real, but it left the width untested, so it is pinned
  // here with an operand that does separate the two.
  const addOnce = (operand: Rational) => ({
    id: 'grid',
    label: 'Add once',
    intent: 'Pin the wide grid.',
    initial: ZERO,
    steps: [{ op: 'add' as const, operand }],
  });

  const wideFinalAt = (operand: Rational, bits: number) =>
    compareRepresentations(addOnce(operand), { wideFractionBits: bits }).find(
      (run) => run.representation === 'wide-fixed-point',
    )!.final!;

  it('defaults to 128, which is what makes it comparable to Q128.128', () => {
    // The first attempt at pinning the width missed this: every test below hands
    // the width in, so changing the default went on being invisible. The default
    // is the value the comparison in every other test actually runs at, and the
    // one that makes "the same grid as Q128.128" true rather than a coincidence.
    const byDefault = compareRepresentations(addOnce(rational(1n, 3n))).find(
      (run) => run.representation === 'wide-fixed-point',
    )!.final!;
    expect(equals(byDefault, wideFinalAt(rational(1n, 3n), 128))).toBe(true);
  });

  it('lands on a different point at 127 bits than at 128', () => {
    expect(equals(wideFinalAt(rational(1n, 3n), 127), wideFinalAt(rational(1n, 3n), 128))).toBe(
      false,
    );
  });

  it('records the coincidence, so a future change to it is visible', () => {
    expect(equals(wideFinalAt(rational(1n, 10n), 127), wideFinalAt(rational(1n, 10n), 128))).toBe(
      true,
    );
  });

  it('puts every answer exactly on the grid it was given', () => {
    for (const bits of [32, 64, 127, 128]) {
      const scaled = mul(wideFinalAt(rational(1n, 3n), bits), rational(1n << BigInt(bits)));
      expect(scaled.denominator, `${bits} bits`).toBe(1n);
    }
  });
});

describe('cancellation', () => {
  const runs = runFor(CANCELLATION);

  it('is exact in fixed point, where the numbers are whole', () => {
    // §5: same-scale addition and subtraction are exact if the result fits. Both
    // fixed-point machines hold 10^8 and 1 exactly, so nothing is lost and the
    // answer comes back as 1.
    for (const name of ['q128.128', 'wide-fixed-point'] as const) {
      expect(isZero(runs.get(name)!.divergence!), name).toBe(true);
      expect(runs.get(name)!.final, name).toEqual(rational(1n));
    }
  });

  it('is exact in binary64 too, at this magnitude', () => {
    // Worth asserting rather than assuming a float will fail: 10^8 + 1 is well
    // inside binary64's exact integer range, so it recovers the 1 as well. The
    // cancellation story needs a magnitude past 2^53 to bite, and claiming
    // otherwise here would be the kind of rigged demonstration this project
    // exists not to make.
    expect(isZero(runs.get('binary64')!.divergence!)).toBe(true);
  });
});

describe('a policy that refuses inexact results refuses this workload (§14)', () => {
  const strict = new Map(
    compareRepresentations(ACCUMULATE_TENTHS, { narrowing: SCENARIOS.strict.narrowing }).map(
      (run) => [run.representation, run],
    ),
  );

  it('stops the wide machine on the first tenth', () => {
    const wide = strict.get('wide-fixed-point')!;
    expect(wide.final).toBeUndefined();
    expect(wide.note).toContain('trapped');
    // A refusal is not a large error, and must not be reported as one.
    expect(wide.divergence).toBeUndefined();
  });

  it('leaves the other machines alone, because the policy is only the wide one’s', () => {
    // Worth being explicit about rather than letting the panel imply otherwise:
    // binary64 and Q128.128 have fixed contracts. The scenario selector governs
    // the machine this track built, not the two it inherited.
    for (const name of ['binary64', 'q128.128'] as const) {
      expect(strict.get(name)!.final, name).toBeDefined();
    }
  });

  it('still gets an answer when nothing is lost', () => {
    // Anti-vacuity: if the strict policy trapped on everything, the test above
    // would pass without the trap meaning anything.
    const exactWorkload = new Map(
      compareRepresentations(CANCELLATION, { narrowing: SCENARIOS.strict.narrowing }).map((run) => [
        run.representation,
        run,
      ]),
    );
    expect(exactWorkload.get('wide-fixed-point')!.final).toBeDefined();
  });
});

describe('a machine that cannot hold a value says so', () => {
  it('reports out of range rather than a very large error', () => {
    const beyondQ128 = {
      id: 'beyond',
      label: 'Beyond the fixed-point range',
      intent: 'A magnitude Q128.128 cannot hold.',
      initial: rational(1n),
      steps: [{ op: 'mul' as const, operand: pow10(60) }],
    };
    const runs = new Map(
      compareRepresentations(beyondQ128).map((run) => [run.representation, run]),
    );
    expect(runs.get('q128.128')!.final).toBeUndefined();
    expect(runs.get('q128.128')!.note).toContain('out of range');
    // binary64 reaches 10^60 comfortably, so it still has an answer.
    expect(runs.get('binary64')!.final).toBeDefined();
  });
});
