import { describe, expect, it } from 'vitest';
import { WideError } from './digits';
import { type RoundingRule, narrow } from './narrow';
import { mulWide } from './multiply';
import { rational, roundNearestEvenToBigInt } from '../rational/rational';

const RULES: RoundingRule[] = ['truncate', 'floor', 'ceil', 'nearest', 'nearest-even'];

/** Narrow a Q.16 source into a Q.8 destination, which drops eight bits. */
const q16to8 = (value: bigint, policy?: Parameters<typeof narrow>[0]['policy']) =>
  narrow({
    value,
    sourceFractionBits: 16,
    sourceWidthBits: 64,
    destinationFractionBits: 8,
    destinationWidthBits: 32,
    ...(policy === undefined ? {} : { policy }),
  });

describe('the invariant that makes residue meaningful', () => {
  it('reconstructs the source from the destination and the residue', () => {
    // §9's algebra, applied to narrowing: source = (value << shift) + residue.
    // If this does not hold, "returning the leftovers" is decoration.
    const values = [0n, 1n, 255n, 256n, 257n, 383n, 384n, 385n, -1n, -255n, -256n, -257n, -384n];
    for (const rule of RULES) {
      for (const value of values) {
        const result = q16to8(value, { rounding: rule });
        expect((result.value << 8n) + result.residue, `${value} under ${rule}`).toBe(value);
      }
    }
  });

  it('holds for a wide product narrowed a long way', () => {
    const wide = (1n << 900n) + (1n << 13n) + 12345n;
    const result = narrow({
      value: wide,
      sourceFractionBits: 512,
      sourceWidthBits: 2048,
      destinationFractionBits: 128,
      destinationWidthBits: 1024,
      policy: { range: 'saturate' },
    });
    expect((result.value << 384n) + result.residue).toBe(wide);
  });

  it('reports the lost bits independently of how it rounded', () => {
    // The band §8's picture labels RESIDUE / LOST BITS is a property of where
    // the cut fell, not of the rule applied to it.
    const value = 0b1_0110_0111n;
    const lost = value & 0xffn;
    for (const rule of RULES) {
      expect(q16to8(value, { rounding: rule }).lostBits, rule).toBe(lost);
    }
  });
});

describe('the five rounding rules', () => {
  // 0x180 is exactly halfway between 0x100 and 0x200 once eight bits go.
  const tieUp = 0x180n; // 1.5 in Q.8 terms
  const tieDown = 0x280n; // 2.5

  it('truncates toward zero', () => {
    expect(q16to8(0x1ffn, { rounding: 'truncate' }).value).toBe(1n);
    expect(q16to8(-0x1ffn, { rounding: 'truncate' }).value).toBe(-1n);
  });

  it('floors toward negative infinity', () => {
    expect(q16to8(0x1ffn, { rounding: 'floor' }).value).toBe(1n);
    expect(q16to8(-0x1ffn, { rounding: 'floor' }).value).toBe(-2n);
  });

  it('ceils toward positive infinity', () => {
    expect(q16to8(0x101n, { rounding: 'ceil' }).value).toBe(2n);
    expect(q16to8(-0x1ffn, { rounding: 'ceil' }).value).toBe(-1n);
  });

  it('sends a tie away from zero under nearest', () => {
    expect(q16to8(tieUp, { rounding: 'nearest' }).value).toBe(2n);
    expect(q16to8(-tieUp, { rounding: 'nearest' }).value).toBe(-2n);
  });

  it('sends a tie to the even neighbour under nearest-even', () => {
    // The rule that separates the two: 1.5 → 2, and 2.5 → 2 as well.
    expect(q16to8(tieUp, { rounding: 'nearest-even' }).value).toBe(2n);
    expect(q16to8(tieDown, { rounding: 'nearest-even' }).value).toBe(2n);
    expect(q16to8(tieUp, { rounding: 'nearest' }).value).toBe(2n);
    expect(q16to8(tieDown, { rounding: 'nearest' }).value).toBe(3n);
  });

  it('agrees with the exact-rational rounding already in the core', () => {
    // An independent implementation, written for a different purpose, over
    // `Rational` rather than over shifts. If these two disagree, one of them is
    // wrong and it is worth knowing which before either is trusted.
    for (let raw = -600n; raw <= 600n; raw += 1n) {
      const viaShift = q16to8(raw, { rounding: 'nearest-even' }).value;
      const viaRational = roundNearestEvenToBigInt(rational(raw, 256n));
      expect(viaShift, `${raw}`).toBe(viaRational);
    }
  });

  it('is exact when nothing falls off, under every rule', () => {
    for (const rule of RULES) {
      const result = q16to8(0x300n, { rounding: rule });
      expect(result.exact, rule).toBe(true);
      expect(result.residue, rule).toBe(0n);
      expect(result.value, rule).toBe(3n);
    }
  });
});

describe('reacting to a result that does not fit', () => {
  const tooBig = (policy: Parameters<typeof narrow>[0]['policy']) =>
    narrow({
      value: 1n << 40n,
      sourceFractionBits: 8,
      sourceWidthBits: 64,
      destinationFractionBits: 0,
      destinationWidthBits: 16,
      ...(policy === undefined ? {} : { policy }),
    });

  it('traps by default rather than quietly producing a wrong number', () => {
    expect(() => tooBig(undefined)).toThrow(WideError);
    expect(() => tooBig({ range: 'trap' })).toThrow(/does not fit/);
  });

  it('saturates to the destination maximum when asked', () => {
    const result = tooBig({ range: 'saturate' });
    expect(result.value).toBe((1n << 15n) - 1n);
    expect(result.overflow).toBe(true);
  });

  it('wraps two-s complement when asked', () => {
    const result = tooBig({ range: 'wrap' });
    expect(result.overflow).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(-(1n << 15n));
    expect(result.value).toBeLessThan(1n << 15n);
  });

  it('saturates downward too', () => {
    const result = narrow({
      value: -(1n << 40n),
      sourceFractionBits: 8,
      sourceWidthBits: 64,
      destinationFractionBits: 0,
      destinationWidthBits: 16,
      policy: { range: 'saturate' },
    });
    expect(result.value).toBe(-(1n << 15n));
  });
});

describe('reacting to inexactness', () => {
  it('allows it by default, and says so', () => {
    const result = q16to8(0x1ffn);
    expect(result.inexact).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.lostBits).toBe(0xffn);
  });

  it('traps when the caller requires an exact narrowing', () => {
    // §8 EXACT_REQUIRED. The point of the policy is that some callers would
    // rather fail than proceed on a number that is no longer the one they had.
    expect(() => q16to8(0x1ffn, { inexact: 'trap' })).toThrow(/requires an exact result/);
  });

  it('does not trap when nothing was lost', () => {
    expect(() => q16to8(0x300n, { inexact: 'trap' })).not.toThrow();
  });
});

describe('accumulating the residue', () => {
  it('carries the leftovers forward across a sequence', () => {
    // §13: residue may be accumulated. The property worth having is that the
    // kept values plus the accumulated leftovers still describe the exact total,
    // so the loss is deferred rather than destroyed.
    const sources = [0x1ffn, 0x101n, 0x180n, 0x2c3n, -0x1ffn];
    let accumulator = 0n;
    let keptTotal = 0n;
    for (const source of sources) {
      // The running total is threaded through by the caller rather than held
      // inside `narrow`, which stays a pure function of its request.
      const result = narrow({
        value: source,
        sourceFractionBits: 16,
        sourceWidthBits: 64,
        destinationFractionBits: 8,
        destinationWidthBits: 32,
        policy: { residue: 'accumulate' },
        residueAccumulator: accumulator,
      });
      accumulator = result.residueAccumulator!;
      keptTotal += result.value << 8n;
    }
    expect(keptTotal + accumulator).toBe(sources.reduce((sum, value) => sum + value, 0n));
  });

  it('offers no accumulator when the policy does not ask for one', () => {
    expect(q16to8(0x1ffn, { residue: 'keep' }).residueAccumulator).toBeUndefined();
    expect(q16to8(0x1ffn, { residue: 'discard' }).residueAccumulator).toBeUndefined();
  });

  it('still returns the residue when the policy discards it', () => {
    // Discarding is a decision the caller makes about a value it was given, not
    // a reason to withhold the value. Keeping the bits until someone chooses to
    // throw them away means handing them over first.
    expect(q16to8(0x1ffn, { residue: 'discard' }).residue).not.toBe(0n);
  });
});

describe('multiply wide, narrow later — the separation §7 asks for', () => {
  it('loses nothing until the narrowing, and then exactly what it says', () => {
    // Two Q128.128 values. The product genuinely needs 256 fraction bits, and
    // `MUL_WIDE` keeps them; deciding to go back to 128 is a separate act with
    // its own policy, and the bits it drops come back as the residue.
    const a = (1n << 128n) + 3n; // 1 + 3·2^-128
    const b = (1n << 128n) + 5n;
    const product = mulWide(a, b, { digitBits: 64, registerBits: 256 });
    expect(product.exact).toBe(true);
    expect(product.value).toBe(a * b);

    const narrowed = narrow({
      value: product.value,
      sourceFractionBits: 256,
      sourceWidthBits: 512,
      destinationFractionBits: 128,
      destinationWidthBits: 256,
    });

    // The full product is recoverable from what was kept and what was returned.
    expect((narrowed.value << 128n) + narrowed.residue).toBe(product.value);
    expect(narrowed.inexact).toBe(true);
    expect(narrowed.lostBits).toBe(15n); // 3 × 5, the sub-LSB part
  });

  it('is exact end to end when the product happens to fit', () => {
    const a = 1n << 128n; // exactly 1
    const b = 3n << 128n; // exactly 3
    const product = mulWide(a, b, { digitBits: 64, registerBits: 256 });
    const narrowed = narrow({
      value: product.value,
      sourceFractionBits: 256,
      sourceWidthBits: 512,
      destinationFractionBits: 128,
      destinationWidthBits: 256,
      policy: { inexact: 'trap' },
    });
    expect(narrowed.exact).toBe(true);
    expect(narrowed.value).toBe(3n << 128n);
  });

  it('would have thrown the same bits away silently as a fused operation', () => {
    // The contrast §7 draws. Rounding inside the multiply gives the same digits
    // and no residue, and no way for the caller to know what happened.
    const a = (1n << 128n) + 3n;
    const b = (1n << 128n) + 5n;
    const wide = mulWide(a, b, { digitBits: 64, registerBits: 256 }).value;
    const narrowed = narrow({
      value: wide,
      sourceFractionBits: 256,
      sourceWidthBits: 512,
      destinationFractionBits: 128,
      destinationWidthBits: 256,
      policy: { rounding: 'truncate' },
    });
    expect(narrowed.value).toBe(wide >> 128n);
    expect(narrowed.residue).not.toBe(0n);
  });
});

describe('what it reports about itself', () => {
  it('reports both widths and the significant bits it processed', () => {
    const result = q16to8((1n << 40n) + 1n, { range: 'saturate' });
    expect(result.sourceWidth).toBe(64);
    expect(result.destinationWidth).toBe(32);
    expect(result.significantBitsProcessed).toBe(41);
  });

  it('counts digits only when told a digit width', () => {
    expect(q16to8(0x1ffn).digitsProcessed).toBeUndefined();
    const withDigits = narrow({
      value: (1n << 200n) + 1n,
      sourceFractionBits: 16,
      sourceWidthBits: 1024,
      destinationFractionBits: 8,
      destinationWidthBits: 1024,
      digitBits: 64,
    });
    expect(withDigits.digitsProcessed).toBe(4);
  });

  it('refuses to widen, which is a different operation', () => {
    expect(() =>
      narrow({
        value: 1n,
        sourceFractionBits: 8,
        sourceWidthBits: 64,
        destinationFractionBits: 16,
        destinationWidthBits: 64,
      }),
    ).toThrow(/cannot add fraction bits/);
  });

  it('is exact and free of decisions when nothing is dropped', () => {
    const result = narrow({
      value: 12345n,
      sourceFractionBits: 8,
      sourceWidthBits: 64,
      destinationFractionBits: 8,
      destinationWidthBits: 64,
    });
    expect(result.value).toBe(12345n);
    expect(result.exact).toBe(true);
    expect(result.residue).toBe(0n);
  });
});
