import { describe, expect, it } from 'vitest';
import { WideError } from './digits';
import { DIVISION_ALGORITHMS, divRem, divideUntilExact, refine } from './divide';

describe('the invariant DIV_REM exists to hold', () => {
  it('satisfies A = Q × B + R for every sign combination', () => {
    // §9. The implementation divides magnitudes and applies signs at the
    // boundary; this is the assertion that the boundary is right.
    const pairs: [bigint, bigint][] = [
      [17n, 5n],
      [-17n, 5n],
      [17n, -5n],
      [-17n, -5n],
      [0n, 7n],
      [1n, 1n],
      [(1n << 512n) + 12345n, (1n << 100n) - 1n],
      [-(1n << 300n), 7n],
    ];
    for (const [a, b] of pairs) {
      const result = divRem({ dividend: a, divisor: b });
      expect(result.quotient * b + result.remainder, `${a} ÷ ${b}`).toBe(a);
    }
  });

  it('keeps the remainder smaller than the divisor', () => {
    for (const [a, b] of [
      [17n, 5n],
      [-17n, 5n],
      [(1n << 400n) - 1n, 123456789n],
    ] as [bigint, bigint][]) {
      const result = divRem({ dividend: a, divisor: b });
      const magnitude = result.remainder < 0n ? -result.remainder : result.remainder;
      expect(magnitude, `${a} ÷ ${b}`).toBeLessThan(b < 0n ? -b : b);
    }
  });

  it('agrees with the language, which never enters the implementation', () => {
    // The oracle. `divRem` shifts, compares and subtracts a bit at a time and
    // never divides; these two meet only here.
    const values = [1n, 2n, 3n, 7n, 255n, 65537n, (1n << 64n) - 1n, (1n << 200n) + 7n];
    for (const a of values) {
      for (const b of values) {
        const result = divRem({ dividend: a, divisor: b });
        expect(result.quotient, `${a} ÷ ${b}`).toBe(a / b);
        expect(result.remainder, `${a} mod ${b}`).toBe(a % b);
      }
    }
  });

  it('refuses to divide by zero rather than inventing a quotient', () => {
    expect(() => divRem({ dividend: 1n, divisor: 0n })).toThrow(WideError);
  });
});

describe('fixed-point division scales the numerator (§11)', () => {
  it('holds A × 2^F = Q × B + R', () => {
    const a = 1n;
    const b = 3n;
    for (const fractionBits of [0, 8, 64, 128]) {
      const result = divRem({ dividend: a, divisor: b, fractionBits });
      expect(result.quotient * b + result.remainder, `1/3 at ${fractionBits} fraction bits`).toBe(
        a << BigInt(fractionBits),
      );
    }
  });

  it('gets one third right to the requested precision', () => {
    // 1/3 in binary is 0.010101…, so the quotient at F bits is (2^F - 1)/3
    // rounded down, and the remainder says the expansion has not ended.
    const result = divRem({ dividend: 1n, divisor: 3n, fractionBits: 8 });
    expect(result.quotient).toBe(0b01010101n);
    expect(result.exact).toBe(false);
    expect(result.remainder).toBe(1n);
  });

  it('is exact when the division terminates in binary', () => {
    const result = divRem({ dividend: 1n, divisor: 4n, fractionBits: 8 });
    expect(result.exact).toBe(true);
    expect(result.remainder).toBe(0n);
    expect(result.quotient).toBe(1n << 6n);
  });

  it('rejects a negative precision request', () => {
    expect(() => divRem({ dividend: 1n, divisor: 3n, fractionBits: -1 })).toThrow(WideError);
  });
});

describe('asking for more digits rather than being given a rounded answer (§12)', () => {
  it('continues from the remainder instead of starting again', () => {
    const first = divRem({ dividend: 1n, divisor: 3n, fractionBits: 8 });
    const more = refine(first, 8);
    expect(more.fractionBits).toBe(16);
    expect(more.quotient * 3n + more.remainder).toBe(1n << 16n);
    // Refining twice by eight equals asking for sixteen up front.
    const direct = divRem({ dividend: 1n, divisor: 3n, fractionBits: 16 });
    expect(more.quotient).toBe(direct.quotient);
    expect(more.remainder).toBe(direct.remainder);
  });

  it('composes over several refinements', () => {
    let result = divRem({ dividend: 22n, divisor: 7n, fractionBits: 0 });
    for (const step of [16, 16, 32]) result = refine(result, step);
    expect(result.fractionBits).toBe(64);
    expect(result.quotient * 7n + result.remainder).toBe(22n << 64n);
    expect(result.quotient).toBe(divRem({ dividend: 22n, divisor: 7n, fractionBits: 64 }).quotient);
  });

  it('costs more work for more precision, which is the point', () => {
    // §12: "execution time can therefore scale with requested precision."
    const cheap = divRem({ dividend: 1n, divisor: 3n, fractionBits: 16 });
    const dear = divRem({ dividend: 1n, divisor: 3n, fractionBits: 256 });
    expect(dear.metrics.quotientDigitsGenerated).toBeGreaterThan(
      cheap.metrics.quotientDigitsGenerated,
    );
    expect(dear.metrics.modeledCycles).toBeGreaterThan(cheap.metrics.modeledCycles);
  });

  it('carries the work already done into the refinement', () => {
    const first = divRem({ dividend: 1n, divisor: 3n, fractionBits: 16 });
    const more = refine(first, 16);
    expect(more.metrics.shiftOperations).toBe(first.metrics.shiftOperations + 16);
    expect(more.metrics.quotientDigitsGenerated).toBe(first.metrics.quotientDigitsGenerated + 16);
  });

  it('refining by nothing changes nothing', () => {
    const first = divRem({ dividend: 22n, divisor: 7n, fractionBits: 8 });
    const same = refine(first, 0);
    expect(same.quotient).toBe(first.quotient);
    expect(same.remainder).toBe(first.remainder);
    expect(same.fractionBits).toBe(first.fractionBits);
  });
});

describe('continue until exact, with a budget', () => {
  it('stops as soon as the expansion terminates', () => {
    const result = divideUntilExact({
      dividend: 1n,
      divisor: 8n,
      maxFractionBits: 512,
    });
    expect(result.exact).toBe(true);
    expect(result.quotient * 8n).toBe(1n << BigInt(result.fractionBits));
    // 1/8 terminates immediately; it should not have spent the whole budget.
    expect(result.fractionBits).toBeLessThan(512);
  });

  it('spends the budget and says it did not finish, for a repeating expansion', () => {
    // One third never terminates in binary. The honest outcome is an inexact
    // result at the requested precision, not a rounded one pretending to be
    // finished.
    const result = divideUntilExact({ dividend: 1n, divisor: 3n, maxFractionBits: 256 });
    expect(result.exact).toBe(false);
    expect(result.fractionBits).toBe(256);
    expect(result.quotient * 3n + result.remainder).toBe(1n << 256n);
  });

  it('never returns a quotient that has absorbed the remainder', () => {
    // §9: "Do not conceptually add the remainder back into the quotient."
    const result = divideUntilExact({ dividend: 1n, divisor: 3n, maxFractionBits: 64 });
    expect(result.remainder).not.toBe(0n);
    expect(result.quotient * 3n).toBeLessThan(1n << 64n);
  });
});

describe('what the division reports about its work', () => {
  it('names the algorithm rather than implying there is only one', () => {
    // §10: do not lock the project to one algorithm until benchmarks exist.
    expect(divRem({ dividend: 7n, divisor: 3n }).metrics.algorithm).toBe('restoring-radix-2');
  });

  it('counts shifts, compares and subtracts separately', () => {
    const result = divRem({ dividend: 0b1011n, divisor: 0b11n });
    // Four bits of dividend: four shifts, four compares, and a subtract only
    // where the divisor fitted.
    expect(result.metrics.shiftOperations).toBe(4);
    expect(result.metrics.compareOperations).toBe(4);
    expect(result.metrics.subtractOperations).toBeGreaterThan(0);
    expect(result.metrics.subtractOperations).toBeLessThanOrEqual(4);
  });

  it('lets the cost of each primitive be set, since the trade is the experiment', () => {
    const base = divRem({ dividend: (1n << 200n) + 1n, divisor: 7n });
    const costly = divRem({
      dividend: (1n << 200n) + 1n,
      divisor: 7n,
      cyclesPerSubtract: 10,
    });
    expect(costly.metrics.modeledCycles).toBeGreaterThan(base.metrics.modeledCycles);
    expect(costly.quotient).toBe(base.quotient);
  });

  it('reports the significant widths it actually worked on', () => {
    const result = divRem({ dividend: (1n << 300n) + 1n, divisor: 255n, fractionBits: 8 });
    expect(result.metrics.significantWidthDividend).toBe(309);
    expect(result.metrics.significantWidthDivisor).toBe(8);
  });

  it('does no work at all for a zero dividend', () => {
    const result = divRem({ dividend: 0n, divisor: 7n });
    expect(result.quotient).toBe(0n);
    expect(result.remainder).toBe(0n);
    expect(result.exact).toBe(true);
    expect(result.metrics.quotientDigitsGenerated).toBe(0);
  });
});

describe('two algorithms, benchmarked rather than chosen (§10)', () => {
  const cases: [bigint, bigint, number][] = [
    [(1n << 512n) + 12345n, 7n, 0],
    [1n, 3n, 256],
    [(1n << 200n) - 1n, (1n << 64n) + 1n, 64],
    [12345678901234567890n, 987654321n, 128],
    [(1n << 1024n) - 1n, (1n << 512n) - 1n, 0],
  ];

  it('agree on every answer, which is the precondition for comparing them', () => {
    for (const [dividend, divisor, fractionBits] of cases) {
      const results = DIVISION_ALGORITHMS.map((algorithm) =>
        divRem({ dividend, divisor, fractionBits, algorithm }),
      );
      const [first, ...rest] = results;
      for (const other of rest) {
        expect(other!.quotient, `${dividend} ÷ ${divisor}`).toBe(first!.quotient);
        expect(other!.remainder, `${dividend} ÷ ${divisor}`).toBe(first!.remainder);
      }
    }
  });

  it('disagree about the work, which is the reason to have both', () => {
    // Restoring pays a magnitude comparison every step and a subtraction only
    // when the divisor fits. Non-restoring pays an add-or-subtract every step
    // and no comparison at all, plus at most one correction at the end.
    const [dividend, divisor] = [(1n << 512n) + 12345n, 7n] as const;
    const restoring = divRem({ dividend, divisor, algorithm: 'restoring-radix-2' }).metrics;
    const nonRestoring = divRem({ dividend, divisor, algorithm: 'non-restoring-radix-2' }).metrics;

    expect(restoring.compareOperations).toBeGreaterThan(0);
    expect(nonRestoring.compareOperations).toBe(0);
    expect(nonRestoring.subtractOperations).toBeGreaterThan(restoring.subtractOperations);
    expect(restoring.shiftOperations).toBe(nonRestoring.shiftOperations);
  });

  it('changes which one wins when the cost of a comparison changes', () => {
    // This is the whole point of §10's instruction not to lock the project to
    // one algorithm. Neither is simply better; it depends on what the hardware
    // charges, and the simulator can now say where the crossover is.
    const [dividend, divisor] = [(1n << 512n) + 12345n, 7n] as const;
    const run = (algorithm: (typeof DIVISION_ALGORITHMS)[number], cyclesPerCompare: number) =>
      divRem({ dividend, divisor, algorithm, cyclesPerCompare }).metrics.modeledCycles;

    // Measured, and the crossover is sharper than I expected: on this input
    // restoring makes 513 comparisons to save 345 subtractions, so it wins only
    // while a comparison is literally free, and loses at a cost of one.
    expect(run('restoring-radix-2', 0)).toBeLessThan(run('non-restoring-radix-2', 0));
    expect(run('restoring-radix-2', 1)).toBeGreaterThan(run('non-restoring-radix-2', 1));
  });

  it('takes fewer iterations at a higher radix, which is what the radix is for', () => {
    const [dividend, divisor] = [(1n << 512n) + 12345n, 7n] as const;
    const shifts = (algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend, divisor, algorithm }).metrics.shiftOperations;

    // 513 bits, taken one, two and three at a time.
    expect(shifts('restoring-radix-2')).toBe(513);
    expect(shifts('restoring-radix-4')).toBe(257);
    expect(shifts('restoring-radix-8')).toBe(171);
  });

  it('does not save comparisons, and the table is not free', () => {
    // Worth stating because the intuition is that a bigger radix is cheaper
    // everywhere, and it is not. Digit selection is a binary search over the
    // table, so it costs one comparison per quotient *bit* whatever the radix —
    // the same as radix-2 — and radix-4 pays one more than radix-2 here because
    // 513 bits do not divide into 2-bit digits without a padded top one.
    const [dividend, divisor] = [(1n << 512n) + 12345n, 7n] as const;
    const at = (algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend, divisor, algorithm }).metrics;

    expect(at('restoring-radix-2').compareOperations).toBe(513);
    expect(at('restoring-radix-4').compareOperations).toBe(514);
    expect(at('restoring-radix-8').compareOperations).toBe(513);

    expect(at('restoring-radix-2').tableOperations).toBe(0);
    expect(at('restoring-radix-4').tableOperations).toBe(2);
    expect(at('restoring-radix-8').tableOperations).toBe(6);
  });

  it('makes the radix a question about the size of the division', () => {
    // The result I did not expect, and the reason §10 says to measure. On a
    // 513-bit division radix-8 is the cheapest of the restoring family; on a
    // ten-bit one it is the most expensive of all four, because six additions
    // of table setup are not repaid by a loop that only runs four times.
    //
    // So there is no answer to "which radix", only an answer to "which radix
    // for this size", and the table above is the reason a benchmark had to
    // exist before anything was chosen.
    const big = (algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend: (1n << 512n) + 12345n, divisor: 7n, algorithm }).metrics.modeledCycles;
    const small = (algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend: 1000n, divisor: 7n, algorithm }).metrics.modeledCycles;

    expect(big('restoring-radix-8')).toBeLessThan(big('restoring-radix-4'));
    expect(big('restoring-radix-4')).toBeLessThan(big('restoring-radix-2'));

    expect(small('restoring-radix-8')).toBeGreaterThan(small('restoring-radix-2'));
    expect(small('restoring-radix-4')).toBeLessThan(small('restoring-radix-2'));
  });

  it('hands it to non-restoring once a comparison is expensive enough', () => {
    // And the radix does not rescue the restoring family from that, because a
    // higher radix does not buy fewer comparisons. Non-restoring makes none at
    // all, so at four cycles a comparison it wins outright: 1027 against 2396.
    const [dividend, divisor] = [(1n << 512n) + 12345n, 7n] as const;
    const at = (algorithm: (typeof DIVISION_ALGORITHMS)[number], cyclesPerCompare: number) =>
      divRem({ dividend, divisor, algorithm, cyclesPerCompare }).metrics.modeledCycles;

    expect(at('non-restoring-radix-2', 4)).toBeLessThan(at('restoring-radix-8', 4));
    expect(at('non-restoring-radix-2', 0)).toBeGreaterThan(at('restoring-radix-8', 0));
  });

  it('pays in multiplications rather than in iterations', () => {
    // §10 lists the reciprocal method because the architecture already has
    // MUL_WIDE, so a divider built out of multiplies needs no new hardware. Its
    // work is a different shape, not a smaller amount of the same shape.
    const m = divRem({
      dividend: (1n << 512n) + 12345n,
      divisor: 7n,
      algorithm: 'reciprocal-newton',
    }).metrics;

    expect(m.shiftOperations).toBe(0);
    expect(m.subtractOperations).toBe(0);
    expect(m.multiplyOperations).toBe(20);
    // Twenty multiplies and eleven comparisons against five hundred iterations.
    expect(m.compareOperations).toBe(11);
  });

  it('needs a temporary wider than the register the architecture declares', () => {
    // The cost that does not appear as cycles. A digit-serial divider never
    // holds more than a remainder — one bit here — while Newton holds a value
    // about twice the quotient. On a 513-bit division that is 1026 bits, which
    // does not fit the 1024-bit register this project is named after.
    const loop = divRem({
      dividend: (1n << 512n) + 12345n,
      divisor: 7n,
      algorithm: 'restoring-radix-8',
    }).metrics;
    const newton = divRem({
      dividend: (1n << 512n) + 12345n,
      divisor: 7n,
      algorithm: 'reciprocal-newton',
    }).metrics;

    expect(loop.temporaryBits).toBe(1);
    expect(newton.temporaryBits).toBe(1026);
    expect(newton.temporaryBits).toBeGreaterThan(1024);
  });

  it('is decided by the multiplier, not by the division', () => {
    // The result that matters, and the reason this could not be settled by
    // reasoning. The same division costs 18194 cycles with an 8-bit multiplier
    // and 375 with a 128-bit one — a factor of 48 — so whether trading division
    // for multiplication pays is a question about the multiplier you have.
    // Every loop above lands between 857 and 1194 on this input.
    const at = (multiplyDigitBits: 8 | 128) =>
      divRem({
        dividend: (1n << 512n) + 12345n,
        divisor: 7n,
        algorithm: 'reciprocal-newton',
        multiplyDigitBits,
      }).metrics.modeledCycles;
    const bestLoop = divRem({
      dividend: (1n << 512n) + 12345n,
      divisor: 7n,
      algorithm: 'restoring-radix-8',
    }).metrics.modeledCycles;

    expect(at(8)).toBeGreaterThan(bestLoop * 10);
    expect(at(128)).toBeLessThan(bestLoop / 2);
  });

  it('gets cheaper as the divisor gets wider, and the loops do not', () => {
    // A digit-serial divider consumes every bit of the dividend whatever the
    // divisor, so its cost barely moves. Newton's estimate is about
    // `2^scale / B`, which is a *smaller number* for a wider divisor and so a
    // cheaper thing to multiply by. Measured on 2^512 − 1: the loop goes 861 →
    // 691 across the range while the reciprocal goes 861 → 264.
    const dividend = (1n << 512n) - 1n;
    const cycles = (bits: number, algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend, divisor: (1n << BigInt(bits)) - 1n, algorithm }).metrics.modeledCycles;

    expect(cycles(2, 'reciprocal-newton')).toBe(cycles(2, 'restoring-radix-8'));
    expect(cycles(400, 'reciprocal-newton')).toBeLessThan(cycles(400, 'restoring-radix-8') / 2);
  });

  it('is sensitive to sparsity in a way the loops are not', () => {
    // Because its work is multiplication, and `mulWide` skips zero digits (§4).
    // The same-size division costs the loop 857 sparse and 860 dense; it costs
    // Newton 770 sparse and 920 dense, which flips which method wins.
    const cycles = (dividend: bigint, algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend, divisor: 7n, algorithm }).metrics.modeledCycles;
    const sparse = (1n << 512n) + 12345n;
    const dense = (1n << 512n) - 1n;

    expect(cycles(sparse, 'reciprocal-newton')).toBeLessThan(cycles(sparse, 'restoring-radix-8'));
    expect(cycles(dense, 'reciprocal-newton')).toBeGreaterThan(cycles(dense, 'restoring-radix-8'));

    const loopSwing = cycles(dense, 'restoring-radix-8') - cycles(sparse, 'restoring-radix-8');
    const newtonSwing = cycles(dense, 'reciprocal-newton') - cycles(sparse, 'reciprocal-newton');
    expect(newtonSwing).toBeGreaterThan(loopSwing * 20);
  });

  it('loses badly on a small division, where the estimate is most of the work', () => {
    const small = (algorithm: (typeof DIVISION_ALGORITHMS)[number]) =>
      divRem({ dividend: 1000n, divisor: 7n, algorithm }).metrics.modeledCycles;
    expect(small('reciprocal-newton')).toBeGreaterThan(small('restoring-radix-4'));
  });

  it('refines from either, because both leave the remainder in range', () => {
    // A non-restoring run corrects at the end, so its state satisfies the
    // invariant a restoring continuation needs.
    for (const algorithm of DIVISION_ALGORITHMS) {
      const first = divRem({ dividend: 1n, divisor: 7n, fractionBits: 8, algorithm });
      const more = refine(first, 24);
      expect(more.quotient * 7n + more.remainder, algorithm).toBe(1n << 32n);
      expect(more.metrics.algorithm, 'the leading digits keep their provenance').toBe(algorithm);
    }
  });
});

describe('division and narrowing are different decisions', () => {
  it('leaves the choice of what to do with the remainder to the caller', () => {
    // The remainder is exact information about what did not fit. Turning it into
    // a rounded quotient is a narrowing policy, applied afterwards and on
    // purpose — not something division does on the caller's behalf.
    const result = divRem({ dividend: 1n, divisor: 3n, fractionBits: 8 });
    expect(result.quotient).toBe(0b01010101n);
    expect(result.remainder).toBe(1n);

    // Had the caller wanted nearest-even at this scale, that is a second step
    // with its own name, and it would round up here because 1/3 of the way past
    // is not a tie but the next bit is set.
    const refined = refine(result, 1);
    expect(refined.quotient & 1n).toBe(0n);
  });
});

describe('the identity holds at every step, not only at the end (§22)', () => {
  // §22 asks for `A = Q × B + R` to be displayed continuously while the quotient
  // digits appear. That is only worth drawing if it is true at every frame, so
  // the trace is checked against the loop invariant it claims to expose:
  //
  //     consumed = quotient × divisor + remainder
  //
  // where `consumed` is the part of the scaled dividend the machine has read so
  // far. The end-of-run identity is a special case, which is the point.
  const CASES = [
    { dividend: (1n << 512n) + 12345n, divisor: 7n, fractionBits: 0 },
    { dividend: 1n, divisor: 3n, fractionBits: 24 },
    { dividend: -1000n, divisor: 7n, fractionBits: 8 },
    { dividend: 1000n, divisor: -7n, fractionBits: 8 },
    { dividend: 0n, divisor: 5n, fractionBits: 4 },
    { dividend: 255n, divisor: 256n, fractionBits: 0 },
  ] as const;

  // The reciprocal method produces no quotient digits in order, so there is
  // nothing here for it to satisfy. That is a fact about the method rather than
  // an exemption, and it gets its own test below.
  const DIGIT_SERIAL = DIVISION_ALGORITHMS.filter((name) => name !== 'reciprocal-newton');

  for (const algorithm of DIGIT_SERIAL) {
    it(`holds under ${algorithm}`, () => {
      let stepsSeen = 0;
      for (const { dividend, divisor, fractionBits } of CASES) {
        const result = divRem({ dividend, divisor, fractionBits, algorithm, trace: true });
        const magnitude = divisor < 0n ? -divisor : divisor;
        const steps = result.steps!;
        stepsSeen += steps.length;

        for (const step of steps) {
          expect(step.consumed, `${dividend}/${divisor} at bit ${step.index}`).toBe(
            step.quotientSoFar * magnitude + step.remainder,
          );
        }
      }
      // Anti-vacuity: a zero dividend produces no steps at all, and a suite of
      // those would satisfy the loop above without examining anything. The floor
      // is well under the real figures and has to clear the *smallest* of them,
      // which is radix-8's — a higher radix takes bigger bites and so produces
      // fewer steps for the same division. Measured over these cases: 582 at
      // radix 2, 584 non-restoring — the extra two are its end corrections —
      // 292 at radix 4 and 195 at radix 8.
      expect(stepsSeen, 'steps examined').toBeGreaterThan(150);
    });
  }

  it('leaves the remainder non-negative at every restoring step', () => {
    const result = divRem({ dividend: 1n, divisor: 3n, fractionBits: 32, trace: true });
    for (const step of result.steps!) expect(step.remainder >= 0n).toBe(true);
  });

  it('lets the remainder go negative under non-restoring, which is the algorithm', () => {
    // Not a defect to be smoothed over: subtracting unconditionally is exactly
    // what buys the missing comparison, and a trace that hid it would be drawing
    // a restoring division under a non-restoring label.
    const result = divRem({
      dividend: 1n,
      divisor: 3n,
      fractionBits: 32,
      algorithm: 'non-restoring-radix-2',
      trace: true,
    });
    expect(result.steps!.some((step) => step.remainder < 0n)).toBe(true);
  });

  it('has nothing to trace when nothing is produced in order', () => {
    // §22 asks for the quotient digits to be animated. A reciprocal divider does
    // not have any: it estimates the whole quotient at once and corrects. Asking
    // for a trace gets an empty one rather than invented frames, and the panel
    // says so rather than drawing a tape that means nothing.
    const result = divRem({
      dividend: (1n << 200n) + 7n,
      divisor: 11n,
      fractionBits: 16,
      algorithm: 'reciprocal-newton',
      trace: true,
    });
    expect(result.steps).toEqual([]);
    // And it still answers, which is the part that matters.
    expect(result.quotient * 11n + result.remainder).toBe(((1n << 200n) + 7n) << 16n);
  });

  it('ends where the untraced division ends', () => {
    // The trace must be a record of the run, not a second run beside it.
    for (const algorithm of DIGIT_SERIAL) {
      const request = { dividend: (1n << 200n) + 7n, divisor: 11n, fractionBits: 16, algorithm };
      const plain = divRem(request);
      const traced = divRem({ ...request, trace: true });
      expect(traced.quotient, algorithm).toBe(plain.quotient);
      expect(traced.remainder, algorithm).toBe(plain.remainder);
      expect(traced.metrics, algorithm).toEqual(plain.metrics);
      const last = traced.steps![traced.steps!.length - 1]!;
      const magnitude = plain.quotient < 0n ? -plain.quotient : plain.quotient;
      expect(last.quotient, algorithm).toBe(magnitude);
      // And the two accounts of the quotient agree once the run is over, which
      // is what makes the signed-digit column a different route to the same
      // number rather than a different number.
      expect(last.quotientSoFar, algorithm).toBe(magnitude);
      expect(last.remainder, algorithm).toBe(
        plain.remainder < 0n ? -plain.remainder : plain.remainder,
      );
    }
  });

  it('costs nothing when it is not asked for', () => {
    expect(divRem({ dividend: 100n, divisor: 7n }).steps).toBeUndefined();
  });
});
