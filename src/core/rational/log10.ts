/**
 * Exact-safe order of magnitude and display log10.
 *
 * docs/NUMERICS.md §13: the Atlas must position values far outside binary64's
 * exponent range, so we never coerce the whole rational to `Number`. We find
 * the decimal exponent with integer comparisons, normalize the value into
 * [1, 10) exactly, and only then convert that bounded mantissa to a double.
 */

import {
  type Rational,
  RationalError,
  abs,
  bitLength,
  div,
  gte,
  isZero,
  lt,
  pow10,
  sign,
} from './rational';

const LOG10_OF_2 = Math.log10(2);

/** Digits of mantissa precision handed to the double. Comfortably past binary64's ~17. */
const MANTISSA_DIGITS = 20n;
const MANTISSA_SCALE = 10n ** MANTISSA_DIGITS;
const MANTISSA_SCALE_AS_NUMBER = 1e20;

/**
 * The integer `e` such that `10^e <= |value| < 10^(e+1)`.
 *
 * Exact for arbitrarily huge or tiny rationals. Throws at zero, where the
 * order of magnitude is undefined.
 */
export function orderOfMagnitude10(value: Rational): number {
  if (isZero(value)) {
    throw new RationalError('Order of magnitude is undefined at zero');
  }
  const magnitude = abs(value);

  // A cheap bit-length estimate lands within a digit or two; exact comparisons
  // below do the rest. bitLength difference bounds log2 of the ratio.
  let e = Math.floor(
    (bitLength(magnitude.numerator) - bitLength(magnitude.denominator)) * LOG10_OF_2,
  );

  while (lt(magnitude, pow10(e))) {
    e -= 1;
  }
  while (gte(magnitude, pow10(e + 1))) {
    e += 1;
  }
  return e;
}

/** Decomposition of `|value|` as `mantissa × 10^exponent` with `1 <= mantissa < 10`. */
export interface DecimalDecomposition {
  /** Sign of the original value: -1, 0 or 1. */
  sign: -1 | 0 | 1;
  exponent: number;
  /** Exact mantissa in [1, 10). Exactly 0 when the value is zero. */
  mantissa: Rational;
}

export function decomposeDecimal(value: Rational): DecimalDecomposition {
  if (isZero(value)) {
    return { sign: 0, exponent: 0, mantissa: { numerator: 0n, denominator: 1n } };
  }
  const exponent = orderOfMagnitude10(value);
  return {
    sign: sign(value),
    exponent,
    mantissa: div(abs(value), pow10(exponent)),
  };
}

/**
 * log10 of a positive rational, as a bounded double suitable for camera/display
 * state. The value itself is never converted to `Number` — only the [1, 10)
 * mantissa is.
 *
 * `log10RationalForDisplay(pow10(400))` returns 400 even though `1e400` is
 * `Infinity` as a double.
 */
export function log10RationalForDisplay(value: Rational): number {
  if (sign(value) <= 0) {
    throw new RationalError('log10 requires a strictly positive value');
  }
  const { exponent, mantissa } = decomposeDecimal(value);

  // mantissa is in [1, 10), so this bigint quotient is at most 10^21.
  const scaled = (mantissa.numerator * MANTISSA_SCALE) / mantissa.denominator;
  const mantissaAsNumber = Number(scaled) / MANTISSA_SCALE_AS_NUMBER;

  return exponent + Math.log10(mantissaAsNumber);
}

/**
 * Convert a rational to a double, saturating rather than producing garbage.
 * Only for bounded display work — never for machine state.
 */
export function toNumberForDisplay(value: Rational): number {
  if (isZero(value)) return 0;
  const { sign: s, exponent, mantissa } = decomposeDecimal(value);
  if (exponent > 308) return s > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (exponent < -324) return s > 0 ? 0 : -0;
  const scaled = (mantissa.numerator * MANTISSA_SCALE) / mantissa.denominator;
  const mantissaAsNumber = Number(scaled) / MANTISSA_SCALE_AS_NUMBER;
  return s * mantissaAsNumber * Math.pow(10, exponent);
}
