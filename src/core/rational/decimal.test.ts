import { describe, expect, it } from 'vitest';
import {
  formatDecimal,
  toExactDecimalString,
  toFixedDecimal,
  toSignificantDecimal,
} from './decimal';
import { ZERO, pow10, rational } from './rational';
import { parseDecimalExact } from './parse';

const r = rational;

describe('toFixedDecimal', () => {
  it('renders and reports exactness', () => {
    expect(toFixedDecimal(r(1n, 4n), 2)).toEqual({ text: '0.25', exact: true });
    expect(toFixedDecimal(r(1n, 3n), 4)).toEqual({ text: '0.3333', exact: false });
    expect(toFixedDecimal(r(-1n, 8n), 3)).toEqual({ text: '-0.125', exact: true });
  });

  it('trims trailing zeros unless asked to keep them', () => {
    expect(toFixedDecimal(r(1n, 2n), 5).text).toBe('0.5');
    expect(toFixedDecimal(r(1n, 2n), 5, 'nearest-even', true).text).toBe('0.50000');
  });

  it('rounds half to even by default', () => {
    expect(toFixedDecimal(r(25n, 100n), 1).text).toBe('0.2');
    expect(toFixedDecimal(r(35n, 100n), 1).text).toBe('0.4');
  });

  it('accepts negative precision, rounding above the ones place', () => {
    expect(toFixedDecimal(r(123456n), -3)).toEqual({ text: '123000', exact: false });
  });
});

describe('toSignificantDecimal', () => {
  it('keeps the requested number of significant digits', () => {
    expect(toSignificantDecimal(r(1n, 3n), 6).text).toBe('0.333333');
    expect(toSignificantDecimal(r(123456789n), 4).text).toBe('123500000');
    expect(toSignificantDecimal(parseDecimalExact('0.00075'), 2).text).toBe('0.00075');
  });

  it('handles the carry into the next decade', () => {
    expect(toSignificantDecimal(parseDecimalExact('9.999'), 3).text).toBe('10');
    expect(toSignificantDecimal(parseDecimalExact('0.09999'), 3).text).toBe('0.1');
  });

  it('renders zero without an order of magnitude', () => {
    expect(toSignificantDecimal(ZERO, 4)).toEqual({ text: '0', exact: true });
  });

  it('rejects fewer than one significant digit', () => {
    expect(() => toSignificantDecimal(r(1n, 3n), 0)).toThrow(RangeError);
  });

  it('marks a rounded rendering as inexact and an exact one as exact', () => {
    expect(toSignificantDecimal(r(1n, 8n), 4).exact).toBe(true);
    expect(toSignificantDecimal(r(1n, 3n), 40).exact).toBe(false);
  });
});

describe('formatDecimal', () => {
  it('prefers fractionDigits when both are supplied', () => {
    expect(formatDecimal(r(1n, 3n), { fractionDigits: 2, significantDigits: 9 }).text).toBe('0.33');
  });

  it('defaults to significant digits', () => {
    expect(formatDecimal(r(2n, 3n)).text).toBe('0.666667');
  });
});

describe('toExactDecimalString', () => {
  it('expands terminating fractions completely', () => {
    expect(toExactDecimalString(r(1n, 8n))).toBe('0.125');
    expect(toExactDecimalString(r(-1n, 10n))).toBe('-0.1');
    expect(toExactDecimalString(r(5n))).toBe('5');
    expect(toExactDecimalString(ZERO)).toBe('0');
  });

  it('renders the full exact value stored by binary64 for 0.1', () => {
    // 0.1 as a double is 3602879701896397 / 2^55 exactly.
    expect(toExactDecimalString(r(3602879701896397n, 2n ** 55n))).toBe(
      '0.1000000000000000055511151231257827021181583404541015625',
    );
  });

  it('handles huge exact magnitudes', () => {
    expect(toExactDecimalString(pow10(30))).toBe('1000000000000000000000000000000');
  });

  it('returns undefined for repeating expansions rather than truncating', () => {
    expect(toExactDecimalString(r(1n, 3n))).toBeUndefined();
    expect(toExactDecimalString(r(1n, 7n))).toBeUndefined();
  });
});
