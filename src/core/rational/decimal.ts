/**
 * Decimal rendering of exact rationals.
 *
 * Formatting rounds for humans; the underlying value never changes
 * (CLAUDE.md rule 2). Every result carries an `exact` flag so the UI can say
 * whether what it printed *is* the value or only a rounding of it.
 */

import { type Rational, type RoundingMode, isZero, mul, pow10, roundToBigInt } from './rational';
import { orderOfMagnitude10 } from './log10';

export interface DecimalText {
  text: string;
  /** True when `text` reproduces the rational exactly. */
  exact: boolean;
}

export interface DecimalOptions {
  /** Significant digits to keep. Ignored when `fractionDigits` is given. */
  significantDigits?: number;
  /** Fixed digits after the decimal point. */
  fractionDigits?: number;
  rounding?: RoundingMode;
  /** Keep trailing zeros in the fraction instead of trimming them. */
  keepTrailingZeros?: boolean;
}

const DEFAULT_SIGNIFICANT_DIGITS = 6;

/**
 * Render `scaled / 10^fractionDigits` as a plain decimal string.
 * Negative `fractionDigits` means the value was rounded above the ones place.
 */
function composeDecimal(
  scaled: bigint,
  fractionDigits: number,
  keepTrailingZeros: boolean,
): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString(10);

  let text: string;
  if (fractionDigits <= 0) {
    text = digits + '0'.repeat(-fractionDigits);
  } else {
    const padded = digits.padStart(fractionDigits + 1, '0');
    const integerPart = padded.slice(0, padded.length - fractionDigits);
    let fractionPart = padded.slice(padded.length - fractionDigits);
    if (!keepTrailingZeros) {
      fractionPart = fractionPart.replace(/0+$/, '');
    }
    text = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart;
  }
  return negative ? `-${text}` : text;
}

/** Round `value` to `fractionDigits` places and report whether that was lossless. */
export function toFixedDecimal(
  value: Rational,
  fractionDigits: number,
  rounding: RoundingMode = 'nearest-even',
  keepTrailingZeros = false,
): DecimalText {
  const shifted = mul(value, pow10(fractionDigits));
  const exact = shifted.denominator === 1n;
  const scaled = roundToBigInt(shifted, rounding);
  return { text: composeDecimal(scaled, fractionDigits, keepTrailingZeros), exact };
}

/**
 * Render with a number of significant digits. Handles the carry case where
 * rounding pushes the value into the next decade (9.999 -> 10.00).
 */
export function toSignificantDecimal(
  value: Rational,
  significantDigits: number,
  rounding: RoundingMode = 'nearest-even',
  keepTrailingZeros = false,
): DecimalText {
  if (significantDigits < 1) {
    throw new RangeError('significantDigits must be at least 1');
  }
  if (isZero(value)) {
    return { text: '0', exact: true };
  }

  const exponent = orderOfMagnitude10(value);
  const fractionDigits = significantDigits - 1 - exponent;

  // Rounding may gain a digit (9.999 -> 10.00). When it does, drop one place so
  // the caller still gets exactly `significantDigits` significant digits.
  const rounded = roundToBigInt(mul(value, pow10(fractionDigits)), rounding);
  const roundedDigits = (rounded < 0n ? -rounded : rounded).toString(10).length;
  const corrected = roundedDigits > significantDigits ? fractionDigits - 1 : fractionDigits;

  return toFixedDecimal(value, corrected, rounding, keepTrailingZeros);
}

export function formatDecimal(value: Rational, options: DecimalOptions = {}): DecimalText {
  const rounding = options.rounding ?? 'nearest-even';
  const keepTrailingZeros = options.keepTrailingZeros ?? false;
  if (options.fractionDigits !== undefined) {
    return toFixedDecimal(value, options.fractionDigits, rounding, keepTrailingZeros);
  }
  return toSignificantDecimal(
    value,
    options.significantDigits ?? DEFAULT_SIGNIFICANT_DIGITS,
    rounding,
    keepTrailingZeros,
  );
}

/**
 * The full exact decimal expansion, available only when the denominator has no
 * prime factors besides 2 and 5. Returns `undefined` otherwise rather than
 * silently truncating — a repeating decimal is not an exact decimal.
 */
export function toExactDecimalString(value: Rational): string | undefined {
  let d = value.denominator;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos += 1;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives += 1;
  }
  if (d !== 1n) return undefined;

  const fractionDigits = Math.max(twos, fives);
  const shifted = mul(value, pow10(fractionDigits));
  return composeDecimal(shifted.numerator, fractionDigits, false);
}
