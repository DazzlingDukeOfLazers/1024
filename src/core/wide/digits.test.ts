import { describe, expect, it } from 'vitest';
import {
  DIGIT_WIDTHS,
  type DigitWidth,
  WideError,
  bitLength,
  dispatchFor,
  fromDigits,
  leadingZeros,
  partialProducts,
  profile,
  toDigits,
  trailingZeros,
} from './digits';

describe('bit measurements', () => {
  it('counts the bits a magnitude occupies', () => {
    expect(bitLength(0n)).toBe(0);
    expect(bitLength(1n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(256n)).toBe(9);
    expect(bitLength((1n << 1024n) - 1n)).toBe(1024);
  });

  it('reports leading zeros against the declared width', () => {
    // The whole point of §3: a 1024-bit register holding a small number.
    expect(leadingZeros(1n, 1024)).toBe(1023);
    expect(leadingZeros(0n, 1024)).toBe(1024);
    expect(leadingZeros((1n << 1024n) - 1n, 1024)).toBe(0);
  });

  it('refuses a value wider than the register that declares it', () => {
    expect(() => leadingZeros(1n << 1024n, 1024)).toThrow(WideError);
  });

  it('leaves trailing zeros undefined for zero rather than guessing', () => {
    expect(trailingZeros(0n)).toBeUndefined();
    expect(trailingZeros(1n)).toBe(0);
    expect(trailingZeros(1n << 700n)).toBe(700);
    expect(trailingZeros((1n << 700n) + (1n << 12n))).toBe(12);
  });

  it('is defined on magnitudes, and says so', () => {
    expect(() => bitLength(-1n)).toThrow(/magnitude/);
    expect(() => trailingZeros(-1n)).toThrow(/magnitude/);
  });
});

describe('radix-2^N decomposition', () => {
  it('splits on a power-of-two boundary, which loses nothing', () => {
    // §2: LOW = A & (2^N - 1), HIGH = A >> N. No approximation is introduced,
    // so the only property worth asserting is that it round-trips exactly.
    const value = (1n << 700n) + (1n << 300n) + 12345n;
    for (const digitBits of DIGIT_WIDTHS) {
      expect(fromDigits(toDigits(value, digitBits), digitBits), `${digitBits}-bit digits`).toBe(
        value,
      );
    }
  });

  it('round-trips every width for a spread of magnitudes', () => {
    const values = [0n, 1n, 255n, 256n, (1n << 128n) - 1n, 1n << 1023n, (1n << 1024n) - 1n];
    for (const digitBits of DIGIT_WIDTHS) {
      for (const value of values) {
        expect(fromDigits(toDigits(value, digitBits, 1024), digitBits)).toBe(value);
      }
    }
  });

  it('pads to the declared register so digit twelve of sixteen exists', () => {
    const digits = toDigits(1n, 64, 1024);
    expect(digits).toHaveLength(16);
    expect(digits[0]).toBe(1n);
    expect(digits.slice(1).every((digit) => digit === 0n)).toBe(true);
  });

  it('orders digits least significant first', () => {
    expect(toDigits(0x0102n, 8)).toEqual([0x02n, 0x01n]);
  });

  it('refuses a value too wide for the register, rather than truncating it', () => {
    expect(() => toDigits(1n << 1024n, 64, 1024)).toThrow(/register holds/);
  });

  it('refuses a digit that does not fit its own radix', () => {
    expect(() => fromDigits([256n], 8)).toThrow(/does not fit/);
  });
});

describe('significant-width dispatch', () => {
  it('picks a path from what is there, not from what was declared', () => {
    expect(dispatchFor(0)).toBe('tiny');
    expect(dispatchFor(16)).toBe('tiny');
    expect(dispatchFor(17)).toBe('native');
    expect(dispatchFor(64)).toBe('native');
    expect(dispatchFor(65)).toBe('medium');
    expect(dispatchFor(128)).toBe('medium');
    expect(dispatchFor(129)).toBe('wide');
    expect(dispatchFor(1024)).toBe('wide');
  });

  it('sends a small number in a huge register down the tiny path', () => {
    // The claim §3 makes: "a nominally 1024-bit machine may often process far
    // less than 1024 meaningful bits."
    expect(profile(5n, 64, 1024).path).toBe('tiny');
    expect(profile(5n, 64, 1024).declaredBits).toBe(1024);
    expect(profile(5n, 64, 1024).significantBits).toBe(3);
  });
});

describe('what a wide register is actually carrying', () => {
  // §4's example: wide, and sparse.
  const sparse = (1n << 700n) + (1n << 12n);

  it('finds the information in two digits of sixteen', () => {
    const report = profile(sparse, 64, 1024);
    expect(report.digits).toHaveLength(16);
    expect(report.nonzeroDigits).toBe(2);
    expect(report.highestNonzero).toBe(10); // 700 / 64
    expect(report.lowestNonzero).toBe(0); // 12 / 64
  });

  it('reports declared and significant width separately', () => {
    const report = profile(sparse, 64, 1024);
    expect(report.declaredBits).toBe(1024);
    expect(report.significantBits).toBe(701);
    expect(report.path).toBe('wide');
  });

  it('narrows the digit width and finds the same sparsity in more digits', () => {
    const wide = profile(sparse, 128, 1024);
    const narrow = profile(sparse, 8, 1024);
    expect(wide.digits).toHaveLength(8);
    expect(narrow.digits).toHaveLength(128);
    // Two set bits stay two set bits however the register is sliced.
    expect(wide.nonzeroDigits).toBe(2);
    expect(narrow.nonzeroDigits).toBe(2);
  });

  it('has no highest or lowest non-zero digit for a zero register', () => {
    const report = profile(0n, 64, 1024);
    expect(report.nonzeroDigits).toBe(0);
    expect(report.highestNonzero).toBeUndefined();
    expect(report.lowestNonzero).toBeUndefined();
    expect(report.significantBits).toBe(0);
  });

  it('counts every digit when the register is full', () => {
    const report = profile((1n << 1024n) - 1n, 64, 1024);
    expect(report.nonzeroDigits).toBe(16);
    expect(report.significantBits).toBe(1024);
  });
});

describe('partial products a multiply would face', () => {
  it('counts the full matrix for dense values', () => {
    // §6: 16 × 16 = 256 for a 1024-bit value in 64-bit digits.
    const dense = profile((1n << 1024n) - 1n, 64, 1024);
    expect(partialProducts(dense, dense)).toEqual({
      possible: 256,
      executed: 256,
      skipped: 0,
    });
  });

  it('shows how much sparsity could save', () => {
    const sparse = profile((1n << 700n) + (1n << 12n), 64, 1024);
    // Two non-zero digits each way: four products of a possible 256.
    expect(partialProducts(sparse, sparse)).toEqual({
      possible: 256,
      executed: 4,
      skipped: 252,
    });
  });

  it('reports skipping without claiming it is free', () => {
    // The count is the evidence, not the conclusion — §4 is explicit that the
    // control cost of skipping is itself a configurable thing to measure.
    const one = profile(1n, 64, 1024);
    const result = partialProducts(one, one);
    expect(result.executed).toBe(1);
    expect(result.possible).toBe(256);
    expect(result.executed + result.skipped).toBe(result.possible);
  });

  it('refuses to compare profiles sliced differently', () => {
    const a = profile(1n, 64, 1024);
    const b = profile(1n, 32, 1024);
    expect(() => partialProducts(a, b)).toThrow(/common digit width/);
  });
});

describe('the decomposition is exact for every configured slice width', () => {
  it('agrees with plain BigInt arithmetic on a spread of values', () => {
    // The architecture doc's §19 rule, applied at this level: never use the
    // simulator's own result as its reference. Here the reference is the
    // language's own big integers.
    const values = [
      0n,
      1n,
      (1n << 64n) - 1n,
      1n << 64n,
      (1n << 700n) + (1n << 12n),
      (1n << 1024n) - 1n,
    ];
    for (const digitBits of DIGIT_WIDTHS as readonly DigitWidth[]) {
      for (const value of values) {
        const digits = toDigits(value, digitBits, 1024);
        // Rebuild by the definition in §2 rather than by calling fromDigits, so
        // this is a check and not a tautology.
        let rebuilt = 0n;
        for (let index = 0; index < digits.length; index += 1) {
          rebuilt += digits[index]! * (1n << BigInt(digitBits * index));
        }
        expect(rebuilt, `${value} at ${digitBits}-bit digits`).toBe(value);
      }
    }
  });
});
