/**
 * IEEE-754 binary64 inspection and encoding.
 *
 * docs/NUMERICS.md §8. JavaScript `number` is allowed *only* inside this
 * boundary. Everything crossing back out is an exact `Rational` or an explicit
 * state category.
 *
 * The stored value is read from the actual bits with a `DataView`. It is never
 * inferred by printing a decimal string and parsing it back, because that would
 * be approximating the approximation.
 */

import {
  type Rational,
  ZERO,
  abs,
  add,
  div,
  gt,
  isZero,
  mul,
  neg,
  pow2,
  rational,
  roundNearestEvenToBigInt,
  sign,
  sub,
} from '../rational/rational';
import { orderOfMagnitude2 } from '../rational/log10';

export const EXPONENT_BITS = 11;
export const FRACTION_BITS = 52;
export const EXPONENT_BIAS = 1023;

const FRACTION_MASK = (1n << 52n) - 1n;
const EXPONENT_MASK = 0x7ffn;
const IMPLICIT_BIT = 1n << 52n;
const SIGN_BIT = 1n << 63n;
const ALL_BITS = (1n << 64n) - 1n;

/** Unbiased exponent of the subnormal quantum: every subnormal is a multiple of 2^-1074. */
export const MIN_SUBNORMAL_EXPONENT = -1074;
export const MIN_NORMAL_EXPONENT = -1022;
export const MAX_FINITE_EXPONENT = 1023;

/**
 * Scratch buffer for bit/float reinterpretation. It is written and read within
 * a single call and carries nothing between calls, so it is not shared state in
 * the sense CLAUDE.md prohibits.
 */
const scratch = new DataView(new ArrayBuffer(8));

export function bitsOf(value: number): bigint {
  scratch.setFloat64(0, value);
  return scratch.getBigUint64(0);
}

export function numberFromBits(bits: bigint): number {
  scratch.setBigUint64(0, bits & ALL_BITS);
  return scratch.getFloat64(0);
}

/* -------------------------------------------------------------------------- */
/* State categories                                                            */
/* -------------------------------------------------------------------------- */

export type Binary64State =
  | { kind: 'finite'; value: number; signBit: 0 | 1; exact: Rational }
  | { kind: 'positive-infinity' }
  | { kind: 'negative-infinity' }
  | { kind: 'nan'; signBit: 0 | 1; payloadBits?: bigint };

export function fromNumber(value: number): Binary64State {
  const bits = bitsOf(value);
  const signBit: 0 | 1 = (bits & SIGN_BIT) === 0n ? 0 : 1;
  const exponentField = (bits >> 52n) & EXPONENT_MASK;
  const fractionField = bits & FRACTION_MASK;

  if (exponentField === EXPONENT_MASK) {
    if (fractionField === 0n) {
      return signBit === 0 ? { kind: 'positive-infinity' } : { kind: 'negative-infinity' };
    }
    return { kind: 'nan', signBit, payloadBits: fractionField };
  }
  // Finite. Note +0 and -0 both decode to exact zero but keep distinct sign bits.
  return { kind: 'finite', value, signBit, exact: exactFromBits(bits) };
}

export function toNumber(state: Binary64State): number {
  switch (state.kind) {
    case 'finite':
      return state.value;
    case 'positive-infinity':
      return Number.POSITIVE_INFINITY;
    case 'negative-infinity':
      return Number.NEGATIVE_INFINITY;
    case 'nan':
      return Number.NaN;
  }
}

export function isFiniteState(
  state: Binary64State,
): state is Extract<Binary64State, { kind: 'finite' }> {
  return state.kind === 'finite';
}

/** True for `-0`, which decodes to exact zero but is a distinct machine state. */
export function isNegativeZero(value: number): boolean {
  return value === 0 && bitsOf(value) === SIGN_BIT;
}

/* -------------------------------------------------------------------------- */
/* Bit fields                                                                  */
/* -------------------------------------------------------------------------- */

export interface Binary64Fields {
  bits: bigint;
  signBit: 0 | 1;
  /** Raw biased exponent, 0..2047. */
  exponentField: number;
  /** Raw 52-bit fraction, without the implicit leading bit. */
  fractionField: bigint;
  /** Fraction plus the implicit bit for normals; the bare fraction for subnormals. */
  significand: bigint;
  /** Unbiased exponent. Undefined for infinities and NaN. */
  unbiasedExponent?: number;
  isSubnormal: boolean;
  isZero: boolean;
  bitsHex: string;
  /** `s | eeeeeeeeeee | fff…` */
  bitsBinary: string;
}

function exactFromBits(bits: bigint): Rational {
  const negative = (bits & SIGN_BIT) !== 0n;
  const exponentField = (bits >> 52n) & EXPONENT_MASK;
  const fractionField = bits & FRACTION_MASK;

  if (exponentField === 0n) {
    // Subnormal (or zero): no implicit bit, fixed quantum.
    if (fractionField === 0n) return ZERO;
    const magnitude = mul(rational(fractionField), pow2(MIN_SUBNORMAL_EXPONENT));
    return negative ? neg(magnitude) : magnitude;
  }
  const significand = IMPLICIT_BIT | fractionField;
  const exponent = Number(exponentField) - EXPONENT_BIAS - FRACTION_BITS;
  const magnitude = mul(rational(significand), pow2(exponent));
  return negative ? neg(magnitude) : magnitude;
}

export function fields(value: number): Binary64Fields {
  const bits = bitsOf(value);
  const signBit: 0 | 1 = (bits & SIGN_BIT) === 0n ? 0 : 1;
  const exponentFieldRaw = (bits >> 52n) & EXPONENT_MASK;
  const exponentField = Number(exponentFieldRaw);
  const fractionField = bits & FRACTION_MASK;
  const isSpecial = exponentFieldRaw === EXPONENT_MASK;
  const isSubnormal = exponentField === 0 && fractionField !== 0n;

  const binary = bits.toString(2).padStart(64, '0');
  const base: Binary64Fields = {
    bits,
    signBit,
    exponentField,
    fractionField,
    significand: exponentField === 0 ? fractionField : IMPLICIT_BIT | fractionField,
    isSubnormal,
    isZero: exponentField === 0 && fractionField === 0n,
    bitsHex: `0x${bits.toString(16).padStart(16, '0')}`,
    bitsBinary: `${binary.slice(0, 1)} | ${binary.slice(1, 12)} | ${binary.slice(12)}`,
  };

  if (isSpecial || base.isZero) return base;
  return {
    ...base,
    unbiasedExponent: isSubnormal ? MIN_NORMAL_EXPONENT : exponentField - EXPONENT_BIAS,
  };
}

/** Exact stored value of a finite double. Undefined for infinities and NaN. */
export function exactValue(value: number): Rational | undefined {
  return Number.isFinite(value) ? exactFromBits(bitsOf(value)) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Neighbours and gaps                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Next representable value toward +Infinity.
 *
 * Adjacent finite doubles of the same sign are adjacent bit patterns, which is
 * why this needs no exponent special-casing — only the sign boundary at zero.
 */
export function successor(value: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === 0) return numberFromBits(1n); // covers both +0 and -0
  const bits = bitsOf(value);
  return numberFromBits((bits & SIGN_BIT) === 0n ? bits + 1n : bits - 1n);
}

/** Next representable value toward -Infinity. */
export function predecessor(value: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (value === Number.NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;
  if (value === 0) return numberFromBits(SIGN_BIT | 1n);
  const bits = bitsOf(value);
  return numberFromBits((bits & SIGN_BIT) === 0n ? bits - 1n : bits + 1n);
}

export interface NeighborReport {
  below: Binary64State;
  above: Binary64State;
  /** Exact `value - below`. Undefined when the neighbour is not finite. */
  gapBelow?: Rational;
  /** Exact `above - value`. Undefined when the neighbour is not finite. */
  gapAbove?: Rational;
}

/**
 * docs/NUMERICS.md §10: report the two gaps separately. They differ at every
 * power of two, so a single symmetric "ULP" is a lie there.
 */
export function neighbors(value: number): NeighborReport {
  const below = fromNumber(predecessor(value));
  const above = fromNumber(successor(value));
  const exact = exactValue(value);

  if (exact === undefined) return { below, above };

  const report: NeighborReport = { below, above };
  const withBelow = isFiniteState(below)
    ? { ...report, gapBelow: sub(exact, below.exact) }
    : report;
  return isFiniteState(above) ? { ...withBelow, gapAbove: sub(above.exact, exact) } : withBelow;
}

/* -------------------------------------------------------------------------- */
/* Encoding an exact value                                                     */
/* -------------------------------------------------------------------------- */

export interface Binary64Encode {
  state: Binary64State;
  /** `stored - requested`. Undefined when the result is not finite. */
  quantizationError?: Rational;
  overflowedToInfinity: boolean;
  underflowedToZero: boolean;
}

const MAX_FINITE_EXACT = mul(rational((1n << 53n) - 1n), pow2(MAX_FINITE_EXPONENT - FRACTION_BITS));

/**
 * Round an exact rational to binary64, nearest, ties to even — the same rule
 * hardware uses. Written out rather than delegated to `Number(string)` so that
 * values with no decimal literal (1/3, for instance) go through the same path.
 */
export function encodeRational(value: Rational): Binary64Encode {
  if (isZero(value)) {
    return {
      state: { kind: 'finite', value: 0, signBit: 0, exact: ZERO },
      quantizationError: ZERO,
      overflowedToInfinity: false,
      underflowedToZero: false,
    };
  }

  const negative = sign(value) < 0;
  const magnitude = abs(value);

  const exponent = orderOfMagnitude2(magnitude);
  // Subnormals share one fixed quantum; normals get 52 bits below the leading one.
  const quantumExponent = Math.max(exponent - FRACTION_BITS, MIN_SUBNORMAL_EXPONENT);
  const significand = roundNearestEvenToBigInt(div(magnitude, pow2(quantumExponent)));

  if (significand === 0n) {
    const stored: Binary64State = {
      kind: 'finite',
      value: negative ? -0 : 0,
      signBit: negative ? 1 : 0,
      exact: ZERO,
    };
    return {
      state: stored,
      quantizationError: neg(value),
      overflowedToInfinity: false,
      underflowedToZero: true,
    };
  }

  const storedMagnitude = mul(rational(significand), pow2(quantumExponent));
  if (gt(storedMagnitude, MAX_FINITE_EXACT)) {
    return {
      state: negative ? { kind: 'negative-infinity' } : { kind: 'positive-infinity' },
      overflowedToInfinity: true,
      underflowedToZero: false,
    };
  }

  const bits = bitsFromSignificand(significand, quantumExponent, negative);
  const stored = fromNumber(numberFromBits(bits));
  return {
    state: stored,
    quantizationError: sub(isFiniteState(stored) ? stored.exact : ZERO, value),
    overflowedToInfinity: false,
    underflowedToZero: false,
  };
}

/** Assemble bits for `significand × 2^quantumExponent`, which must be representable. */
function bitsFromSignificand(
  significand: bigint,
  quantumExponent: number,
  negative: boolean,
): bigint {
  const signPart = negative ? SIGN_BIT : 0n;

  if (quantumExponent === MIN_SUBNORMAL_EXPONENT && significand < IMPLICIT_BIT) {
    return signPart | significand;
  }

  // Rounding can carry the significand up to exactly 2^53; renormalize.
  let mantissa = significand;
  let quantum = quantumExponent;
  if (mantissa === IMPLICIT_BIT << 1n) {
    mantissa >>= 1n;
    quantum += 1;
  }

  const exponentField = BigInt(quantum + FRACTION_BITS + EXPONENT_BIAS);
  return signPart | (exponentField << 52n) | (mantissa & FRACTION_MASK);
}

/* -------------------------------------------------------------------------- */
/* Arithmetic with an exact operand                                            */
/* -------------------------------------------------------------------------- */

export interface Binary64Add {
  state: Binary64State;
  /** Error introduced encoding the operand. */
  operandQuantizationError: Rational;
  /**
   * Error the addition itself introduced, measured against what the already
   * represented inputs imply (docs/NUMERICS.md §7). Unlike fixed point, this is
   * routinely non-zero.
   */
  operationRoundingError?: Rational;
}

export function addRational(state: Binary64State, operand: Rational): Binary64Add {
  const encodedOperand = encodeRational(operand);
  const operandQuantizationError = encodedOperand.quantizationError ?? ZERO;

  if (!isFiniteState(state) || !isFiniteState(encodedOperand.state)) {
    return {
      state: fromNumber(toNumber(state) + toNumber(encodedOperand.state)),
      operandQuantizationError,
    };
  }

  const result = fromNumber(state.value + encodedOperand.state.value);
  const idealFromRepresentedInputs = add(state.exact, encodedOperand.state.exact);

  return isFiniteState(result)
    ? {
        state: result,
        operandQuantizationError,
        operationRoundingError: sub(result.exact, idealFromRepresentedInputs),
      }
    : { state: result, operandQuantizationError };
}

/* -------------------------------------------------------------------------- */
/* Error reporting                                                             */
/* -------------------------------------------------------------------------- */

/**
 * docs/NUMERICS.md §9. Undefined at a zero reference — the UI must say so
 * rather than silently rendering infinity.
 */
export function relativeError(represented: Rational, exact: Rational): Rational | undefined {
  if (isZero(exact)) return undefined;
  return div(sub(represented, exact), exact);
}

/**
 * docs/NUMERICS.md §10. Expresses how far the exact intent sits from the stored
 * result as a fraction of a *named* local gap, rather than as one ambiguous ULP
 * number.
 */
export interface GapRelativeError {
  /** Which gap the error is measured against. */
  gap: 'below' | 'above';
  gapSize: Rational;
  /** `|stored - intent| / gapSize`. */
  fractionOfGap: Rational;
}

export function errorInLocalGaps(stored: number, intent: Rational): GapRelativeError | undefined {
  const exact = exactValue(stored);
  if (exact === undefined) return undefined;

  const difference = sub(exact, intent);
  const { gapBelow, gapAbove } = neighbors(stored);

  // Rounding moved the value away from the intent, so the intent lies in the
  // gap on the opposite side. When they agree exactly, either gap describes the
  // local resolution equally well.
  const side: 'below' | 'above' = sign(difference) > 0 ? 'below' : 'above';
  const gap = side === 'below' ? (gapBelow ?? gapAbove) : (gapAbove ?? gapBelow);
  if (gap === undefined || isZero(gap)) return undefined;

  return { gap: side, gapSize: gap, fractionOfGap: div(abs(difference), gap) };
}
