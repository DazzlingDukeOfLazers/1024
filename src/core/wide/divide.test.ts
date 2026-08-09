import { describe, expect, it } from 'vitest';
import { WideError } from './digits';
import { divRem, divideUntilExact, refine } from './divide';

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
