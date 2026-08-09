/**
 * Exact rational arithmetic — the authoritative `ExactReference` value type.
 *
 * See docs/NUMERICS.md §1. This is unbounded mathematical truth, not a finite
 * simulated machine. Nothing here may fall back to JavaScript `number`.
 */

export interface Rational {
  readonly numerator: bigint;
  /** Always > 0. Sign lives entirely in the numerator. */
  readonly denominator: bigint;
}

export class RationalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RationalError';
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Construct a normalized rational. Denominator sign is folded into the numerator. */
export function rational(numerator: bigint, denominator: bigint = 1n): Rational {
  if (denominator === 0n) {
    throw new RationalError('Rational denominator must not be zero');
  }
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) {
    return ZERO;
  }
  const g = gcd(n, d);
  return { numerator: n / g, denominator: d / g };
}

export const ZERO: Rational = { numerator: 0n, denominator: 1n };
export const ONE: Rational = { numerator: 1n, denominator: 1n };

export function fromBigInt(value: bigint): Rational {
  return value === 0n ? ZERO : { numerator: value, denominator: 1n };
}

/**
 * Convert a safe JavaScript integer. Rejects non-integers so that a binary64
 * value never leaks into the exact reference by accident — decode binary64
 * through the dedicated inspector instead (docs/NUMERICS.md §8).
 */
export function fromSafeInteger(value: number): Rational {
  if (!Number.isSafeInteger(value)) {
    throw new RationalError(`Not a safe integer: ${value}`);
  }
  return fromBigInt(BigInt(value));
}

export function isZero(value: Rational): boolean {
  return value.numerator === 0n;
}

export function isInteger(value: Rational): boolean {
  return value.denominator === 1n;
}

export function sign(value: Rational): -1 | 0 | 1 {
  if (value.numerator === 0n) return 0;
  return value.numerator < 0n ? -1 : 1;
}

export function neg(value: Rational): Rational {
  return value.numerator === 0n
    ? ZERO
    : { numerator: -value.numerator, denominator: value.denominator };
}

export function abs(value: Rational): Rational {
  return value.numerator < 0n ? neg(value) : value;
}

export function add(a: Rational, b: Rational): Rational {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function sub(a: Rational, b: Rational): Rational {
  return rational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.numerator === 0n) {
    throw new RationalError('Division by exact zero');
  }
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function inv(value: Rational): Rational {
  if (value.numerator === 0n) {
    throw new RationalError('Reciprocal of exact zero');
  }
  return rational(value.denominator, value.numerator);
}

/** -1 if a < b, 0 if equal, 1 if a > b. Exact; denominators are positive. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function equals(a: Rational, b: Rational): boolean {
  // Both operands are normalized, so structural equality is value equality.
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

export function lt(a: Rational, b: Rational): boolean {
  return compare(a, b) < 0;
}
export function lte(a: Rational, b: Rational): boolean {
  return compare(a, b) <= 0;
}
export function gt(a: Rational, b: Rational): boolean {
  return compare(a, b) > 0;
}
export function gte(a: Rational, b: Rational): boolean {
  return compare(a, b) >= 0;
}

export function min(a: Rational, b: Rational): Rational {
  return lte(a, b) ? a : b;
}
export function max(a: Rational, b: Rational): Rational {
  return gte(a, b) ? a : b;
}

/** Exact 2^exponent, for any signed integer exponent. */
export function pow2(exponent: number | bigint): Rational {
  const e = BigInt(exponent);
  return e >= 0n
    ? { numerator: 1n << e, denominator: 1n }
    : { numerator: 1n, denominator: 1n << -e };
}

/** Exact 10^exponent, for any signed integer exponent. */
export function pow10(exponent: number | bigint): Rational {
  const e = BigInt(exponent);
  return e >= 0n
    ? { numerator: 10n ** e, denominator: 1n }
    : { numerator: 1n, denominator: 10n ** -e };
}

/** Exact integer power of a rational. */
export function pow(value: Rational, exponent: number | bigint): Rational {
  const e = BigInt(exponent);
  if (e === 0n) return ONE;
  if (e < 0n) return inv(pow(value, -e));
  return rational(value.numerator ** e, value.denominator ** e);
}

/* -------------------------------------------------------------------------- */
/* Rounding to integers                                                        */
/*                                                                            */
/* These are the primitives the finite fixed-point machines quantize with, so  */
/* the rounding mode is always named explicitly — never implied.               */
/* -------------------------------------------------------------------------- */

export type RoundingMode = 'nearest-even' | 'truncate' | 'floor' | 'ceil';

/** Largest integer <= value. */
export function floorToBigInt(value: Rational): bigint {
  const { numerator: n, denominator: d } = value;
  const q = n / d;
  // BigInt division truncates toward zero; correct for negative remainders.
  return n < 0n && q * d !== n ? q - 1n : q;
}

/** Smallest integer >= value. */
export function ceilToBigInt(value: Rational): bigint {
  const { numerator: n, denominator: d } = value;
  const q = n / d;
  return n > 0n && q * d !== n ? q + 1n : q;
}

/** Integer part, rounding toward zero. */
export function truncateToBigInt(value: Rational): bigint {
  return value.numerator / value.denominator;
}

/** Round half to even (banker's rounding) — the default quantization policy. */
export function roundNearestEvenToBigInt(value: Rational): bigint {
  const { numerator: n, denominator: d } = value;
  const floor = floorToBigInt(value);
  // remainder in [0, d)
  const remainderTimesTwo = 2n * (n - floor * d);
  if (remainderTimesTwo < d) return floor;
  if (remainderTimesTwo > d) return floor + 1n;
  // Exactly halfway: pick the even neighbour.
  return floor % 2n === 0n ? floor : floor + 1n;
}

export function roundToBigInt(value: Rational, mode: RoundingMode): bigint {
  switch (mode) {
    case 'nearest-even':
      return roundNearestEvenToBigInt(value);
    case 'truncate':
      return truncateToBigInt(value);
    case 'floor':
      return floorToBigInt(value);
    case 'ceil':
      return ceilToBigInt(value);
  }
}

/**
 * True when the value has a terminating decimal expansion, i.e. the reduced
 * denominator has no prime factors other than 2 and 5. The UI uses this to
 * decide whether a decimal rendering is exact or merely rounded.
 */
export function hasTerminatingDecimal(value: Rational): boolean {
  let d = value.denominator;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

/** Number of bits in the magnitude of a bigint; 0 for zero. */
export function bitLength(value: bigint): number {
  const v = value < 0n ? -value : value;
  if (v === 0n) return 0;
  return v.toString(2).length;
}
