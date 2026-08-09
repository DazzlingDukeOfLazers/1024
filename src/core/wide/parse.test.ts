import { describe, expect, it } from 'vitest';
import { WideError } from './digits';
import { describeWideLiteral, parseWideLiteral } from './parse';

describe('reading a wide operand', () => {
  it('reads plain integers', () => {
    expect(parseWideLiteral('0')).toBe(0n);
    expect(parseWideLiteral('12345')).toBe(12345n);
    expect(parseWideLiteral('  42  ')).toBe(42n);
  });

  it('reads powers, which is the point of the notation', () => {
    expect(parseWideLiteral('2^10')).toBe(1024n);
    expect(parseWideLiteral('2^1023')).toBe(1n << 1023n);
    expect(parseWideLiteral('10^30')).toBe(10n ** 30n);
  });

  it('reads sums and differences', () => {
    // §4's example, which is 211 decimal digits and nobody would type.
    expect(parseWideLiteral('2^700 + 2^12')).toBe((1n << 700n) + (1n << 12n));
    expect(parseWideLiteral('2^64 - 1')).toBe((1n << 64n) - 1n);
    expect(parseWideLiteral('2^8 + 2^4 + 1')).toBe(256n + 16n + 1n);
  });

  it('reads a leading sign', () => {
    expect(parseWideLiteral('-5')).toBe(-5n);
    expect(parseWideLiteral('-2^10')).toBe(-1024n);
    expect(parseWideLiteral('-2^10 + 24')).toBe(-1000n);
  });

  it('never routes through Number, so nothing is lost on the way in', () => {
    // 2^80 exceeds what a double can hold exactly; a parser that went via
    // `Number` would return a nearby value and look like it had worked.
    expect(parseWideLiteral('2^80 + 1')).toBe((1n << 80n) + 1n);
    expect(parseWideLiteral('9007199254740993')).toBe(9007199254740993n);
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(() => parseWideLiteral('')).toThrow(WideError);
    expect(() => parseWideLiteral('two')).toThrow(/cannot read/);
    expect(() => parseWideLiteral('2^')).toThrow(/cannot read/);
    expect(() => parseWideLiteral('1.5')).toThrow(/cannot read/);
  });
});

describe('describing an operand short enough to read', () => {
  it('shows small values in full', () => {
    expect(describeWideLiteral(42n)).toBe('42');
  });

  it('elides the middle of a very long one and says how long it was', () => {
    const value = (1n << 700n) + (1n << 12n);
    const described = describeWideLiteral(value);
    expect(described).toContain('…');
    expect(described).toContain('digits');
    expect(described.length).toBeLessThan(40);
  });
});
