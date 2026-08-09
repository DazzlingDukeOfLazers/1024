import { describe, expect, it } from 'vitest';
import { DIGIT_WIDTHS, type DigitWidth, WideError } from './digits';
import { mulWide } from './multiply';

const at = (digitBits: DigitWidth, registerBits = 1024) => ({ digitBits, registerBits });

describe('MUL_WIDE keeps every bit', () => {
  it('agrees with the language on a spread of values, at every digit width', () => {
    // §19: never use the simulator's own result as its correctness reference.
    // The implementation accumulates digit by digit and never calls `*` on the
    // whole values; this is the only place the two meet.
    const values = [
      0n,
      1n,
      2n,
      255n,
      256n,
      (1n << 64n) - 1n,
      1n << 64n,
      (1n << 128n) - 1n,
      (1n << 300n) + 7n,
      (1n << 511n) - 1n,
      (1n << 700n) + (1n << 12n),
    ];
    for (const digitBits of DIGIT_WIDTHS) {
      for (const a of values) {
        for (const b of values) {
          expect(mulWide(a, b, at(digitBits)).value, `${a} × ${b} at ${digitBits}`).toBe(a * b);
        }
      }
    }
  });

  it('produces the full double-width product rather than a rounded one', () => {
    // §7: 1024 × 1024 → 2048. The largest pair of 1024-bit magnitudes needs
    // every one of those bits, and none of them are discarded here.
    const max = (1n << 1024n) - 1n;
    const result = mulWide(max, max, at(64));
    expect(result.value).toBe(max * max);
    expect(result.exact).toBe(true);
    expect(result.metrics.destinationWidth).toBe(2048);
    expect(result.metrics.wideTemporaryBits).toBeLessThanOrEqual(2048);
  });

  it('carries sign at the boundary and magnitudes in the digits', () => {
    const a = (1n << 300n) + 7n;
    const b = 123456789n;
    expect(mulWide(-a, b, at(64)).value).toBe(-a * b);
    expect(mulWide(a, -b, at(64)).value).toBe(-(a * b));
    expect(mulWide(-a, -b, at(64)).value).toBe(a * b);
  });

  it('handles zero without pretending it did work', () => {
    const result = mulWide(0n, (1n << 700n) + 1n, at(64));
    expect(result.value).toBe(0n);
    expect(result.metrics.partialProductsExecuted).toBe(0);
    expect(result.metrics.nonzeroDigitsA).toBe(0);
  });

  it('refuses operands wider than the register that declares them', () => {
    expect(() => mulWide(1n << 256n, 1n, at(64, 256))).toThrow(WideError);
  });
});

describe('the work it reports is the work it did', () => {
  it('counts the full matrix for dense operands', () => {
    const dense = (1n << 1024n) - 1n;
    const metrics = mulWide(dense, dense, at(64)).metrics;
    expect(metrics.partialProductsPossible).toBe(256);
    expect(metrics.partialProductsExecuted).toBe(256);
    expect(metrics.partialProductsSkipped).toBe(0);
  });

  it('skips what the zero digits allow', () => {
    // §4's example, multiplied by itself: two non-zero digits each way.
    const sparse = (1n << 700n) + (1n << 12n);
    const metrics = mulWide(sparse, sparse, at(64)).metrics;
    expect(metrics.partialProductsPossible).toBe(256);
    expect(metrics.partialProductsExecuted).toBe(4);
    expect(metrics.partialProductsSkipped).toBe(252);
    expect(metrics.accumulateOperations).toBe(4);
  });

  it('gets the same answer with skipping turned off', () => {
    // The optimization must not be load-bearing for correctness (§14).
    const sparse = (1n << 700n) + (1n << 12n);
    const on = mulWide(sparse, sparse, { ...at(64), skipZeroDigits: true });
    const off = mulWide(sparse, sparse, { ...at(64), skipZeroDigits: false });
    expect(off.value).toBe(on.value);
    expect(off.metrics.partialProductsExecuted).toBe(256);
    expect(on.metrics.partialProductsExecuted).toBe(4);
  });

  it('reports significant width separately from declared width', () => {
    const metrics = mulWide(5n, 7n, at(64)).metrics;
    expect(metrics.architecturalWidth).toBe(1024);
    expect(metrics.significantWidthA).toBe(3);
    expect(metrics.significantWidthB).toBe(3);
  });

  it('shows the accumulator holding a genuinely wide intermediate', () => {
    const a = (1n << 900n) + 1n;
    const metrics = mulWide(a, a, at(64)).metrics;
    expect(metrics.wideTemporaryBits).toBe(1801);
    expect(metrics.wideTemporaryBits).toBeGreaterThan(metrics.architecturalWidth);
  });
});

describe('whether skipping pays is a measurement, not an assumption', () => {
  const sparse = (1n << 700n) + (1n << 12n);

  it('wins on sparse operands when inspection is cheap', () => {
    const cheap = { ...at(64), cyclesPerDigitInspection: 0 };
    const on = mulWide(sparse, sparse, { ...cheap, skipZeroDigits: true });
    const off = mulWide(sparse, sparse, { ...cheap, skipZeroDigits: false });
    expect(on.metrics.modeledCycles).toBeLessThan(off.metrics.modeledCycles);
  });

  it('loses when the control cost of inspecting a digit is high enough', () => {
    // §4: "Do not assume skipping is free. Make its control cost configurable."
    // Skipping inspects both operands' digits in the inner loop, so a costly
    // inspection can exceed the multiplies it avoids. The simulator is supposed
    // to be able to show that.
    const costly = { ...at(64), cyclesPerDigitInspection: 40 };
    const on = mulWide(sparse, sparse, { ...costly, skipZeroDigits: true });
    const off = mulWide(sparse, sparse, { ...costly, skipZeroDigits: false });
    expect(on.metrics.modeledCycles).toBeGreaterThan(off.metrics.modeledCycles);
  });

  it('never changes the answer whichever way the trade falls', () => {
    const costly = { ...at(64), cyclesPerDigitInspection: 40 };
    expect(mulWide(sparse, sparse, { ...costly, skipZeroDigits: true }).value).toBe(
      mulWide(sparse, sparse, { ...costly, skipZeroDigits: false }).value,
    );
  });

  it('costs more cycles at a narrower slice, which is the central trade', () => {
    // §1: more cycles bought with less dedicated wide hardware. A 1024-bit
    // multiply in 8-bit digits faces 128 × 128 partial products; in 128-bit
    // digits it faces 8 × 8.
    const dense = (1n << 1024n) - 1n;
    const narrow = mulWide(dense, dense, at(8)).metrics;
    const wide = mulWide(dense, dense, at(128)).metrics;
    expect(narrow.partialProductsPossible).toBe(128 * 128);
    expect(wide.partialProductsPossible).toBe(8 * 8);
    expect(narrow.modeledCycles).toBeGreaterThan(wide.modeledCycles);
    // And the answer is the same, which is the part that must not be a trade.
    expect(mulWide(dense, dense, at(8)).value).toBe(mulWide(dense, dense, at(128)).value);
  });
});
