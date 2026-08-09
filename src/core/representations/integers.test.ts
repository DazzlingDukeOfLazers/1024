import { describe, expect, it } from 'vitest';
import {
  RegisterWidthError,
  clampSigned,
  fitsSigned,
  fromHex,
  fromTwosComplement,
  isOverflowed,
  signedMax,
  signedMin,
  storeSigned,
  toBinary,
  toHex,
  toTwosComplement,
  wrapSigned,
} from './integers';

describe('signed bounds', () => {
  it("matches the two's-complement definition", () => {
    expect(signedMin(8)).toBe(-128n);
    expect(signedMax(8)).toBe(127n);
    expect(signedMin(256)).toBe(-(2n ** 255n));
    expect(signedMax(256)).toBe(2n ** 255n - 1n);
    expect(signedMin(1024)).toBe(-(2n ** 1023n));
    expect(signedMax(1024)).toBe(2n ** 1023n - 1n);
  });

  it('rejects nonsensical widths', () => {
    expect(() => signedMin(1)).toThrow(RegisterWidthError);
    expect(() => signedMax(8.5)).toThrow(RegisterWidthError);
  });

  it('reports what fits', () => {
    expect(fitsSigned(8, 127n)).toBe(true);
    expect(fitsSigned(8, 128n)).toBe(false);
    expect(fitsSigned(8, -128n)).toBe(true);
    expect(fitsSigned(8, -129n)).toBe(false);
  });
});

describe('wrapping and clamping', () => {
  it('wraps exhaustively within an 8-bit register', () => {
    for (let value = -400n; value <= 400n; value += 1n) {
      const wrapped = wrapSigned(8, value);
      expect(fitsSigned(8, wrapped)).toBe(true);
      // Wrapping is congruent mod 2^8.
      expect((value - wrapped) % 256n).toBe(0n);
    }
  });

  it('wraps at the exact boundary', () => {
    expect(wrapSigned(8, 128n)).toBe(-128n);
    expect(wrapSigned(8, -129n)).toBe(127n);
    expect(wrapSigned(8, 256n)).toBe(0n);
    expect(wrapSigned(256, 2n ** 255n)).toBe(-(2n ** 255n));
  });

  it('clamps to the nearest bound', () => {
    expect(clampSigned(8, 999n)).toBe(127n);
    expect(clampSigned(8, -999n)).toBe(-128n);
    expect(clampSigned(8, 5n)).toBe(5n);
  });

  it('never escapes the declared width', () => {
    for (const width of [8, 16, 128, 256, 1024]) {
      for (const value of [signedMax(width) + 1n, signedMin(width) - 1n, 2n ** 2000n]) {
        expect(fitsSigned(width, wrapSigned(width, value))).toBe(true);
        expect(fitsSigned(width, clampSigned(width, value))).toBe(true);
      }
    }
  });
});

describe('bit patterns', () => {
  it("round-trips two's complement", () => {
    for (let value = -128n; value <= 127n; value += 1n) {
      expect(fromTwosComplement(8, toTwosComplement(8, value))).toBe(value);
    }
  });

  it('encodes known patterns', () => {
    expect(toTwosComplement(8, -1n)).toBe(255n);
    expect(toTwosComplement(8, -128n)).toBe(128n);
    expect(toHex(8, -1n)).toBe('0xff');
    expect(toHex(16, 1n)).toBe('0x0001');
    expect(toBinary(8, -128n)).toBe('10000000');
    expect(toBinary(8, 5n)).toBe('00000101');
  });

  it('produces full-width hex for the big registers', () => {
    expect(toHex(256, 0n)).toBe(`0x${'0'.repeat(64)}`);
    expect(toHex(1024, -1n)).toBe(`0x${'f'.repeat(256)}`);
    expect(fromHex(256, toHex(256, -(2n ** 255n)))).toBe(-(2n ** 255n));
  });

  it('rejects values and patterns outside the width', () => {
    expect(() => toTwosComplement(8, 128n)).toThrow(RegisterWidthError);
    expect(() => fromTwosComplement(8, 256n)).toThrow(RegisterWidthError);
    expect(() => fromHex(8, 'zz')).toThrow(RegisterWidthError);
  });
});

describe('storeSigned', () => {
  it('stores in-range values without an event', () => {
    const result = storeSigned(8, 100n, 'checked');
    expect(result).toEqual({ status: 'stored', value: 100n });
    expect(isOverflowed(result)).toBe(false);
  });

  it('refuses out-of-range writes in checked mode', () => {
    const result = storeSigned(8, 200n, 'checked');
    expect(result.status).toBe('rejected');
    expect(isOverflowed(result)).toBe(true);
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.overflow).toEqual({
      width: 8,
      requested: 200n,
      direction: 'above',
      mode: 'checked',
    });
    // A refused write has no value at all — the caller cannot use one by accident.
    expect('value' in result).toBe(false);
  });

  it('wraps and saturates loudly, never silently', () => {
    const wrapped = storeSigned(8, 200n, 'wrap');
    expect(wrapped.status).toBe('wrapped');
    if (wrapped.status !== 'wrapped') throw new Error('expected wrap');
    expect(wrapped.value).toBe(-56n);
    expect(wrapped.overflow.stored).toBe(-56n);

    const saturated = storeSigned(8, -999n, 'saturate');
    expect(saturated.status).toBe('saturated');
    if (saturated.status !== 'saturated') throw new Error('expected saturation');
    expect(saturated.value).toBe(-128n);
    expect(saturated.overflow.direction).toBe('below');
  });

  it('does not let BigInt make a 256-bit register infinite', () => {
    // The whole point of docs/NUMERICS.md §2.
    const huge = 2n ** 300n;
    expect(storeSigned(256, huge, 'checked').status).toBe('rejected');
    const wrapped = storeSigned(256, huge, 'wrap');
    if (wrapped.status !== 'wrapped') throw new Error('expected wrap');
    expect(fitsSigned(256, wrapped.value)).toBe(true);
  });
});
