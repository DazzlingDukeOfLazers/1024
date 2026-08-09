/**
 * Exact parsing of human-written decimal literals into rationals.
 *
 * `parseDecimalExact('0.1')` is 1/10 exactly — it never routes through
 * `Number`, so the "user intent" side of the 0.1 experiment stays exact
 * (docs/NUMERICS.md §1, PROJECT_SPEC §5).
 */

import { type Rational, RationalError, ZERO, pow10, mul, rational } from './rational';

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function parseDecimalExact(input: string): Rational {
  const text = input.trim().replace(/_/g, '');
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new RationalError(`Not a decimal literal: ${JSON.stringify(input)}`);
  }
  const [, signText, intText = '', fracText = '', expText] = match;
  if (intText.length === 0 && fracText.length === 0) {
    throw new RationalError(`Decimal literal has no digits: ${JSON.stringify(input)}`);
  }

  const digits = `${intText}${fracText}`;
  const magnitude = digits.length > 0 ? BigInt(digits) : 0n;
  const scaled = rational(magnitude, 10n ** BigInt(fracText.length));
  const withExponent = expText === undefined ? scaled : mul(scaled, pow10(Number(expText)));

  if (withExponent.numerator === 0n) return ZERO;
  return signText === '-'
    ? { numerator: -withExponent.numerator, denominator: withExponent.denominator }
    : withExponent;
}

/**
 * Parse `"3/7"`, `"5"`, or any decimal literal accepted by
 * {@link parseDecimalExact}. Used by fixtures and share-state decoding.
 */
export function parseRationalExact(input: string): Rational {
  const text = input.trim();
  const slash = text.indexOf('/');
  if (slash === -1) {
    return parseDecimalExact(text);
  }
  const numeratorText = text.slice(0, slash).trim();
  const denominatorText = text.slice(slash + 1).trim();
  if (!/^[+-]?\d+$/.test(numeratorText) || !/^[+-]?\d+$/.test(denominatorText)) {
    throw new RationalError(`Not an integer fraction: ${JSON.stringify(input)}`);
  }
  return rational(BigInt(numeratorText), BigInt(denominatorText));
}
