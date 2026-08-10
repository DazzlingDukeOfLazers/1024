import { describe, expect, it } from 'vitest';
import { WideError } from '../wide/digits';
import { mulWide } from '../wide/multiply';
import { divRem } from '../wide/divide';
import {
  LIMBS_PER_VALUE,
  PRODUCT_LIMBS,
  addLimbs,
  bitLengthLimbs,
  divRemLimbs,
  fromLimbs,
  mulLimbs,
  shlLimbs,
  shrLimbs,
  subLimbs,
  toLimbs,
} from './limbs';

const TOP = (1n << 1024n) - 1n;

/**
 * Deterministic pseudo-random u32s (mulberry32). Seeded, so a failure is a
 * failure again tomorrow — `Math.random` in a test is a bug report nobody can
 * reproduce.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return (z ^ (z >>> 14)) >>> 0;
  };
}

function randomValue(next: () => number, maxLimbs = LIMBS_PER_VALUE): bigint {
  const limbs = 1 + (next() % maxLimbs);
  let value = 0n;
  for (let i = 0; i < limbs; i += 1) {
    value = (value << 32n) | BigInt(next());
  }
  return value & TOP;
}

describe('the boundary between bigint and limbs', () => {
  it('round-trips, in both directions', () => {
    const next = mulberry32(18);
    for (let i = 0; i < 200; i += 1) {
      const value = randomValue(next);
      expect(fromLimbs(toLimbs(value))).toBe(value);
    }
    expect(fromLimbs(toLimbs(0n))).toBe(0n);
    expect(fromLimbs(toLimbs(TOP))).toBe(TOP);
  });

  it('refuses values that do not fit, instead of wrapping them quietly', () => {
    expect(() => toLimbs(-1n)).toThrow(WideError);
    expect(() => toLimbs(TOP + 1n)).toThrow(WideError);
  });
});

describe('the 32×32→64 primitive, which WGSL forces into 16-bit halves', () => {
  // mul32 is private; mulLimbs with single-limb operands exercises exactly one
  // invocation of it, and the 2048-bit result holds the full 64-bit product.
  const product64 = (a: number, b: number): bigint => {
    const aLimbs = new Uint32Array(LIMBS_PER_VALUE);
    const bLimbs = new Uint32Array(LIMBS_PER_VALUE);
    aLimbs[0] = a;
    bLimbs[0] = b;
    return fromLimbs(mulLimbs(aLimbs, bLimbs).limbs);
  };

  it('agrees with bigint on every corner pair', () => {
    const corners = [
      0, 1, 2, 0xffff, 0x10000, 0x10001, 0x7fffffff, 0x80000000, 0xfffeffff, 0xffffffff,
    ];
    for (const a of corners) {
      for (const b of corners) {
        expect(product64(a, b), `${a} × ${b}`).toBe(BigInt(a) * BigInt(b));
      }
    }
  });

  it('agrees with bigint on twenty thousand seeded random pairs', () => {
    const next = mulberry32(1024);
    for (let i = 0; i < 20000; i += 1) {
      const a = next();
      const b = next();
      expect(product64(a, b), `${a} × ${b}`).toBe(BigInt(a) * BigInt(b));
    }
  });
});

describe('kernels against bigint on seeded random values', () => {
  const next = mulberry32(512);
  const pairs: [bigint, bigint][] = [
    [TOP, 1n],
    [TOP, TOP],
    [0n, 1n],
    [1n << 1023n, (1n << 1023n) + 1n],
  ];
  for (let i = 0; i < 60; i += 1) {
    pairs.push([randomValue(next), randomValue(next)]);
  }

  it('adds', () => {
    for (const [a, b] of pairs) {
      const sum = addLimbs(toLimbs(a), toLimbs(b));
      expect(fromLimbs(sum.limbs), `${a} + ${b}`).toBe((a + b) & TOP);
      expect(sum.carryOut, `${a} + ${b} carry`).toBe(a + b > TOP);
    }
  });

  it('records the carry each lane emitted, and only when asked', () => {
    // The trace exists for the compute panel, so it is checked against the
    // *definition* of a lane carry — lane i carries iff the low i+1 limbs of
    // a and b sum past 2^(32·(i+1)) — not against the loop that produced it.
    for (const [a, b] of pairs.slice(0, 12)) {
      const traced = addLimbs(toLimbs(a), toLimbs(b), true);
      expect(traced.carries).toBeDefined();
      for (let lane = 0; lane < LIMBS_PER_VALUE; lane += 1) {
        const width = BigInt(32 * (lane + 1));
        const mask = (1n << width) - 1n;
        const expected = (a & mask) + (b & mask) >= 1n << width ? 1 : 0;
        expect(traced.carries![lane], `${a} + ${b} lane ${lane}`).toBe(expected);
      }
      expect(traced.carries![LIMBS_PER_VALUE - 1] === 1, `${a} + ${b} top`).toBe(traced.carryOut);
    }
    expect(addLimbs(toLimbs(1n), toLimbs(1n)).carries).toBeUndefined();
  });

  it('propagates one carry across the whole register', () => {
    // The §19 long-carry-chain case, as a picture the panel will draw: all-ones
    // plus one carries in every single lane.
    const traced = addLimbs(toLimbs(TOP), toLimbs(1n), true);
    expect(Array.from(traced.carries!)).toEqual(new Array(LIMBS_PER_VALUE).fill(1));
    expect(traced.carryOut).toBe(true);
    // And the no-carry mirror, so the trace is not just always-ones.
    const calm = addLimbs(toLimbs(1n), toLimbs(2n), true);
    expect(Array.from(calm.carries!)).toEqual(new Array(LIMBS_PER_VALUE).fill(0));
  });

  it('subtracts', () => {
    for (const [a, b] of pairs) {
      const difference = subLimbs(toLimbs(a), toLimbs(b));
      expect(fromLimbs(difference.limbs), `${a} − ${b}`).toBe((a - b) & TOP);
      expect(difference.borrowOut, `${a} − ${b} borrow`).toBe(a < b);
    }
  });

  it('measures bit length', () => {
    for (const [a] of pairs) {
      expect(bitLengthLimbs(toLimbs(a)).bitLength, `${a}`).toBe(
        a.toString(2).length * (a === 0n ? 0 : 1),
      );
    }
    expect(bitLengthLimbs(toLimbs(0n)).bitLength).toBe(0);
  });

  it('shifts both directions, across and inside limb boundaries', () => {
    for (const shift of [0, 1, 31, 32, 33, 64, 511, 512, 1023]) {
      for (const [a] of pairs.slice(0, 12)) {
        expect(fromLimbs(shlLimbs(toLimbs(a), shift).limbs), `${a} << ${shift}`).toBe(
          (a << BigInt(shift)) & TOP,
        );
        expect(fromLimbs(shrLimbs(toLimbs(a), shift).limbs), `${a} >> ${shift}`).toBe(
          a >> BigInt(shift),
        );
      }
    }
  });

  it('multiplies to the full 2048 bits', () => {
    for (const [a, b] of pairs.slice(0, 24)) {
      const product = mulLimbs(toLimbs(a), toLimbs(b));
      expect(product.limbs.length).toBe(PRODUCT_LIMBS);
      expect(fromLimbs(product.limbs), `${a} × ${b}`).toBe(a * b);
    }
  });

  it('divides with the remainder the identity requires', () => {
    for (const [a, b] of pairs) {
      if (b === 0n) continue;
      const { quotient, remainder } = divRemLimbs(toLimbs(a), toLimbs(b));
      expect(fromLimbs(quotient), `${a} ÷ ${b} quotient`).toBe(a / b);
      expect(fromLimbs(remainder), `${a} ÷ ${b} remainder`).toBe(a % b);
    }
  });

  it('refuses to divide by zero', () => {
    expect(() => divRemLimbs(toLimbs(1n), toLimbs(0n))).toThrow(WideError);
  });
});

describe('the limb machine agrees with the digit machine', () => {
  // Two simulations of the same arithmetic with different decompositions —
  // radix-2^64 digits over bigint, u32 limbs over numbers — and different
  // authorship dates. Agreement between them is worth more than either alone.
  it('multiplies like mulWide', () => {
    const next = mulberry32(2048);
    for (let i = 0; i < 30; i += 1) {
      const a = randomValue(next);
      const b = randomValue(next);
      const viaDigits = mulWide(a, b, { digitBits: 64, registerBits: 1024 }).value;
      expect(fromLimbs(mulLimbs(toLimbs(a), toLimbs(b)).limbs), `${a} × ${b}`).toBe(viaDigits);
    }
  });

  it('divides like divRem', () => {
    const next = mulberry32(4096);
    for (let i = 0; i < 30; i += 1) {
      const a = randomValue(next);
      const b = randomValue(next, 8) | 1n; // odd, so never zero
      const viaDigits = divRem({ dividend: a, divisor: b });
      const viaLimbs = divRemLimbs(toLimbs(a), toLimbs(b));
      expect(fromLimbs(viaLimbs.quotient), `${a} ÷ ${b}`).toBe(viaDigits.quotient);
      expect(fromLimbs(viaLimbs.remainder), `${a} ÷ ${b}`).toBe(viaDigits.remainder);
    }
  });
});

describe('what each kernel says passed between its lanes', () => {
  // A view that re-derived these would be a second implementation of the rule,
  // and two implementations of a carry rule are two things that can be wrong.
  it('traces borrows the way it traces carries, and only when asked', () => {
    const a = toLimbs(1n);
    const b = toLimbs(2n);
    expect(subLimbs(a, b).borrows).toBeUndefined();

    // 1 − 2 borrows out of every lane: the lowest wraps and the borrow runs all
    // the way up and off the top.
    const traced = subLimbs(a, b, true);
    expect(traced.borrows).toHaveLength(LIMBS_PER_VALUE);
    expect(Array.from(traced.borrows!).every((lane) => lane === 1)).toBe(true);
    expect(traced.borrowOut).toBe(true);
    expect(traced.borrows![LIMBS_PER_VALUE - 1]).toBe(1);
  });

  it('borrows nowhere when nothing has to be borrowed', () => {
    // Anti-vacuity: a trace that was all ones whatever the operands would pass
    // the test above.
    const traced = subLimbs(toLimbs(2n), toLimbs(1n), true);
    expect(Array.from(traced.borrows!).every((lane) => lane === 0)).toBe(true);
    expect(traced.borrowOut).toBe(false);
  });

  it('traces what each multiply row leaves above itself', () => {
    expect(mulLimbs(toLimbs(3n), toLimbs(5n)).rowCarryOut).toBeUndefined();

    // Small operands: every row finishes inside its own 32 limbs.
    const small = mulLimbs(toLimbs(3n), toLimbs(5n), true);
    expect(small.rowCarryOut).toHaveLength(LIMBS_PER_VALUE);
    expect(Array.from(small.rowCarryOut!).every((carry) => carry === 0)).toBe(true);

    // The densest operands there are: rows do carry out, and where they land is
    // limb `row + 32` — which is exactly what the product holds there.
    const dense = mulLimbs(toLimbs(TOP), toLimbs(TOP), true);
    expect(Array.from(dense.rowCarryOut!).some((carry) => carry !== 0)).toBe(true);
    dense.rowCarryOut!.forEach((carry, row) => {
      expect(dense.limbs[row + LIMBS_PER_VALUE], `row ${row}`).toBe(carry);
    });
  });

  it('changes no answer by being traced', () => {
    // The trace is a diagnostic. If asking for it altered the arithmetic it
    // would be a different machine from the one the fixtures check.
    const a = toLimbs(TOP - 12345n);
    const b = toLimbs(2n ** 700n + 7n);
    expect(Array.from(subLimbs(a, b, true).limbs)).toEqual(Array.from(subLimbs(a, b).limbs));
    expect(Array.from(mulLimbs(a, b, true).limbs)).toEqual(Array.from(mulLimbs(a, b).limbs));
    expect(mulLimbs(a, b, true).metrics).toEqual(mulLimbs(a, b).metrics);
  });
});

describe('the work is counted (§20)', () => {
  it('reports the full schoolbook for dense operands', () => {
    const product = mulLimbs(toLimbs(TOP), toLimbs(TOP));
    // 32 × 32 partial products, four 16-bit multiplies each — no skipping is
    // modeled at limb level yet, so the count is the dense baseline exactly.
    expect(product.metrics.mul16).toBe(4 * 32 * 32);
    expect(product.metrics.modeledCycles).toBeGreaterThan(product.metrics.mul16);
  });

  it('scales division work with the dividend, not the declared width', () => {
    const small = divRemLimbs(toLimbs(1000n), toLimbs(7n));
    const large = divRemLimbs(toLimbs(TOP), toLimbs(7n));
    expect(small.metrics.modeledCycles).toBeLessThan(large.metrics.modeledCycles / 50);
  });

  it('never reports zero work for real work', () => {
    // Anti-vacuity for the metrics themselves.
    const sum = addLimbs(toLimbs(1n), toLimbs(1n));
    expect(sum.metrics.add32).toBeGreaterThan(0);
    expect(sum.metrics.modeledCycles).toBe(
      sum.metrics.add32 + sum.metrics.mul16 + sum.metrics.compare32 + sum.metrics.shift32,
    );
  });
});
