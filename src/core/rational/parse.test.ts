import { describe, expect, it } from 'vitest';
import { parseDecimalExact, parseRationalExact } from './parse';
import { RationalError, ZERO, equals, pow10, rational } from './rational';
import { fromJSON, toCompactString, toJSON } from './json';

describe('parseDecimalExact', () => {
  it('parses 0.1 as exactly one tenth, not as a binary64 approximation', () => {
    const value = parseDecimalExact('0.1');
    expect(value).toEqual({ numerator: 1n, denominator: 10n });
    // Proof that the string never went through Number: 0.1 as a double is
    // 3602879701896397 / 2^55, which is a different rational.
    expect(equals(value, rational(3602879701896397n, 2n ** 55n))).toBe(false);
  });

  it('handles signs, bare points and exponents', () => {
    expect(parseDecimalExact('-2.5')).toEqual({ numerator: -5n, denominator: 2n });
    expect(parseDecimalExact('+2.5')).toEqual({ numerator: 5n, denominator: 2n });
    expect(parseDecimalExact('.5')).toEqual({ numerator: 1n, denominator: 2n });
    expect(parseDecimalExact('5.')).toEqual({ numerator: 5n, denominator: 1n });
    expect(parseDecimalExact('1e3')).toEqual({ numerator: 1000n, denominator: 1n });
    expect(parseDecimalExact('1.5e-3')).toEqual({ numerator: 3n, denominator: 2000n });
    expect(parseDecimalExact('-0')).toEqual(ZERO);
  });

  it('parses magnitudes far outside binary64 range exactly', () => {
    expect(parseDecimalExact('1e400')).toEqual(pow10(400));
    expect(parseDecimalExact('1e-400')).toEqual(pow10(-400));
    // The same literals collapse when routed through Number.
    expect(Number('1e400')).toBe(Number.POSITIVE_INFINITY);
    expect(Number('1e-400')).toBe(0);
  });

  it('ignores underscores and surrounding whitespace', () => {
    expect(parseDecimalExact(' 1_000.5 ')).toEqual({ numerator: 2001n, denominator: 2n });
  });

  it('rejects non-literals', () => {
    for (const bad of ['', '.', 'abc', '1.2.3', '1e', '--1', '1/2']) {
      expect(() => parseDecimalExact(bad)).toThrow(RationalError);
    }
  });
});

describe('parseRationalExact', () => {
  it('accepts fraction syntax', () => {
    expect(parseRationalExact('3/7')).toEqual({ numerator: 3n, denominator: 7n });
    expect(parseRationalExact('-6/8')).toEqual({ numerator: -3n, denominator: 4n });
    expect(parseRationalExact(' 1 / 1000 ')).toEqual({ numerator: 1n, denominator: 1000n });
  });

  it('falls through to decimal syntax', () => {
    expect(parseRationalExact('0.25')).toEqual({ numerator: 1n, denominator: 4n });
  });

  it('rejects non-integer fraction parts', () => {
    expect(() => parseRationalExact('1.5/2')).toThrow(RationalError);
  });
});

describe('json round-trip', () => {
  it('encodes bigints as strings', () => {
    const value = rational(2n ** 300n, 3n);
    const encoded = toJSON(value);
    expect(typeof encoded.numerator).toBe('string');
    expect(typeof encoded.denominator).toBe('string');
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
    expect(fromJSON(encoded)).toEqual(value);
  });

  it('round-trips through an actual JSON string without loss', () => {
    const value = rational(-1n, 10n ** 60n);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(value))))).toEqual(value);
  });

  it('rejects numeric fields, which would silently lose precision', () => {
    expect(() => fromJSON({ numerator: 1 as unknown as string, denominator: '2' })).toThrow(
      RationalError,
    );
    expect(() => fromJSON({ numerator: '1.5', denominator: '2' })).toThrow(RationalError);
  });

  it('writes a compact string form for share URLs', () => {
    expect(toCompactString(rational(1n, 1000n))).toBe('1/1000');
    expect(toCompactString(rational(5n))).toBe('5');
    expect(parseRationalExact(toCompactString(rational(-3n, 7n)))).toEqual(rational(-3n, 7n));
  });
});
