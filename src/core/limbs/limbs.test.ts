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
