/**
 * Human-readable rendering of exact quantities.
 *
 * Engineering notation is the default (CLAUDE.md rule 9). Every result reports
 * whether the printed text is exact, so the UI can distinguish "this is the
 * value" from "this is a rounding of the value" (docs/UI_SPEC.md).
 *
 * Formatting is display only. It never touches quantity or machine state.
 */

import { type Rational, ZERO, div, isZero, mul, neg, pow10 } from '../rational/rational';
import { type DecimalText, formatDecimal } from '../rational/decimal';
import { decomposeDecimal, orderOfMagnitude10 } from '../rational/log10';
import { type Quantity } from '../quantities/quantity';
import { canonicalUnitOf } from './dimensions';
import { engineeringExponentFor, prefixByExponent } from './prefixes';
import { requireUnit } from './units';

export type DisplayMode = 'engineering' | 'scientific' | 'raw';

export interface FormatOptions {
  mode?: DisplayMode;
  significantDigits?: number;
  /** Force a specific display unit instead of choosing one. Display only. */
  unit?: string;
}

export interface FormattedQuantity {
  /** Full rendering, e.g. `7.5 µm`. */
  text: string;
  /** Numeric part only, e.g. `7.5`. */
  mantissa: string;
  /** Unit part only, e.g. `µm`. Empty for dimensionless output. */
  unit: string;
  /** True when `mantissa` reproduces the value exactly in `unit`. */
  exact: boolean;
}

const DEFAULT_SIGNIFICANT_DIGITS = 4;

function render(mantissa: DecimalText, unit: string): FormattedQuantity {
  return {
    text: unit.length > 0 ? `${mantissa.text} ${unit}` : mantissa.text,
    mantissa: mantissa.text,
    unit,
    exact: mantissa.exact,
  };
}

/**
 * Pick the SI prefix that puts the mantissa in [1, 1000), and render in that
 * unit. Zero falls back to the canonical unit — it has no order of magnitude.
 */
export function formatEngineering(q: Quantity, options: FormatOptions = {}): FormattedQuantity {
  const significantDigits = options.significantDigits ?? DEFAULT_SIGNIFICANT_DIGITS;
  const baseSymbol = canonicalUnitOf(q.dimension);

  if (options.unit !== undefined) {
    const unit = requireUnit(options.unit);
    const magnitude = div(q.value, unit.toCanonical);
    return render(formatDecimal(magnitude, { significantDigits }), unit.symbol);
  }

  if (isZero(q.value)) {
    return render(formatDecimal(ZERO, { significantDigits }), baseSymbol);
  }

  const exponent = engineeringExponentFor(orderOfMagnitude10(q.value));
  const prefix = prefixByExponent(exponent);
  const symbol = prefix ? `${prefix.symbol}${baseSymbol}` : baseSymbol;
  const magnitude = mul(q.value, pow10(-exponent));

  return render(formatDecimal(magnitude, { significantDigits }), symbol);
}

/** `7.5 × 10^-6 m`. Always in the canonical SI unit. */
export function formatScientific(q: Quantity, options: FormatOptions = {}): FormattedQuantity {
  const significantDigits = options.significantDigits ?? DEFAULT_SIGNIFICANT_DIGITS;
  const baseSymbol = canonicalUnitOf(q.dimension);

  if (isZero(q.value)) {
    return render({ text: '0', exact: true }, baseSymbol);
  }

  const { exponent, mantissa } = decomposeDecimal(q.value);
  const signedMantissa = q.value.numerator < 0n ? neg(mantissa) : mantissa;
  const rendered = formatDecimal(signedMantissa, { significantDigits });

  return {
    text: `${rendered.text} × 10^${exponent} ${baseSymbol}`,
    mantissa: `${rendered.text} × 10^${exponent}`,
    unit: baseSymbol,
    exact: rendered.exact,
  };
}

/** Plain decimal in the canonical SI unit, e.g. `0.0000075 m`. */
export function formatRawSi(q: Quantity, options: FormatOptions = {}): FormattedQuantity {
  const significantDigits = options.significantDigits ?? DEFAULT_SIGNIFICANT_DIGITS;
  return render(formatDecimal(q.value, { significantDigits }), canonicalUnitOf(q.dimension));
}

export function formatQuantity(q: Quantity, options: FormatOptions = {}): FormattedQuantity {
  switch (options.mode ?? 'engineering') {
    case 'engineering':
      return formatEngineering(q, options);
    case 'scientific':
      return formatScientific(q, options);
    case 'raw':
      return formatRawSi(q, options);
  }
}

/**
 * Render a dimensionless exact ratio, e.g. the comparator's count. Large and
 * small counts fall back to scientific form so the text stays readable.
 */
export function formatCount(value: Rational, significantDigits = 4): DecimalText {
  if (isZero(value)) return { text: '0', exact: true };
  const exponent = orderOfMagnitude10(value);
  if (exponent >= -4 && exponent < 12) {
    return formatDecimal(value, { significantDigits });
  }
  const { mantissa } = decomposeDecimal(value);
  const signedMantissa = value.numerator < 0n ? neg(mantissa) : mantissa;
  const rendered = formatDecimal(signedMantissa, { significantDigits });
  return { text: `${rendered.text} × 10^${exponent}`, exact: rendered.exact };
}
