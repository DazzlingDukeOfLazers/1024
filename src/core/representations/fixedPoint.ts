/**
 * Generic signed binary fixed-point registers.
 *
 * Shared by the Q128.128 metric machine and the Q512.512 error meter
 * (docs/NUMERICS.md §5 and §6). This module knows nothing about physical units
 * — it deals in *machine units*, where one LSB is `2^-fractionBits`.
 *
 * Quantization is always reported, never hidden (CLAUDE.md rule 2).
 */

import {
  type Rational,
  type RoundingMode,
  abs,
  add,
  div,
  mul,
  pow2,
  roundToBigInt,
  sub,
} from '../rational/rational';
import {
  type OverflowEvent,
  type OverflowMode,
  fromHex,
  signedMax,
  signedMin,
  storeSigned,
  toBinary,
  toHex,
} from './integers';

export interface FixedPointFormat {
  /** Total signed register width in bits, including the fraction. */
  widthBits: number;
  fractionBits: number;
}

/** One 256-bit coordinate of the metric spacetime machine. */
export const Q128_128: FixedPointFormat = { widthBits: 256, fractionBits: 128 };

/** The finite 1024-bit error meter. */
export const Q512_512: FixedPointFormat = { widthBits: 1024, fractionBits: 512 };

export interface FixedPointState {
  format: FixedPointFormat;
  raw: bigint;
}

export function integerBits(format: FixedPointFormat): number {
  return format.widthBits - format.fractionBits;
}

/** Smallest representable step, in machine units. Constant across the range. */
export function lsb(format: FixedPointFormat): Rational {
  return pow2(-format.fractionBits);
}

export function minValue(format: FixedPointFormat): Rational {
  return div(
    { numerator: signedMin(format.widthBits), denominator: 1n },
    pow2(format.fractionBits),
  );
}

export function maxValue(format: FixedPointFormat): Rational {
  return div(
    { numerator: signedMax(format.widthBits), denominator: 1n },
    pow2(format.fractionBits),
  );
}

export function zeroState(format: FixedPointFormat): FixedPointState {
  return { format, raw: 0n };
}

/** Exact value held by a raw pattern, in machine units. */
export function decode(state: FixedPointState): Rational {
  return div({ numerator: state.raw, denominator: 1n }, pow2(state.format.fractionBits));
}

export interface FixedPointWrite {
  status: 'stored' | 'wrapped' | 'saturated' | 'rejected';
  /** Absent only when a checked write was refused. */
  state?: FixedPointState;
  /** Exact value now held, in machine units. Absent when refused. */
  decoded?: Rational;
  /**
   * `decoded - requested`, in machine units. This is the quantization error the
   * register introduced, and it is always <= half an LSB under nearest-even.
   */
  quantizationError?: Rational;
  overflow?: OverflowEvent;
}

/**
 * Encode an exact value into the register.
 *
 * Two distinct things can go wrong and they are reported separately:
 * quantization (the value fell between representable steps) and overflow (the
 * value fell outside the register's range entirely).
 */
export function encode(
  format: FixedPointFormat,
  value: Rational,
  rounding: RoundingMode = 'nearest-even',
  overflow: OverflowMode = 'checked',
): FixedPointWrite {
  const scaled = mul(value, pow2(format.fractionBits));
  const raw = roundToBigInt(scaled, rounding);
  const result = storeSigned(format.widthBits, raw, overflow);

  if (result.status === 'rejected') {
    return { status: 'rejected', overflow: result.overflow };
  }

  const state: FixedPointState = { format, raw: result.value };
  const decoded = decode(state);
  const write: FixedPointWrite = {
    status: result.status,
    state,
    decoded,
    quantizationError: sub(decoded, value),
  };
  return result.status === 'stored' ? write : { ...write, overflow: result.overflow };
}

/**
 * Add an exact operand to a register.
 *
 * The operand is quantized on the way in; the subsequent integer addition is
 * exact. That distinction is the educational point of fixed point and must stay
 * inspectable (docs/NUMERICS.md §7).
 */
export interface FixedPointAdd {
  status: 'stored' | 'wrapped' | 'saturated' | 'rejected';
  state?: FixedPointState;
  decoded?: Rational;
  /** Error introduced encoding the operand, in machine units. */
  operandQuantizationError: Rational;
  /** Error introduced by the addition itself. Exactly zero unless it overflowed. */
  operationError?: Rational;
  overflow?: OverflowEvent;
}

export function addExact(
  state: FixedPointState,
  operand: Rational,
  rounding: RoundingMode = 'nearest-even',
  overflow: OverflowMode = 'checked',
): FixedPointAdd {
  const { format } = state;
  const scale = pow2(format.fractionBits);
  const operandRaw = roundToBigInt(mul(operand, scale), rounding);
  const decodedOperand = div({ numerator: operandRaw, denominator: 1n }, scale);
  const operandQuantizationError = sub(decodedOperand, operand);

  const result = storeSigned(format.widthBits, state.raw + operandRaw, overflow);
  if (result.status === 'rejected') {
    return { status: 'rejected', operandQuantizationError, overflow: result.overflow };
  }

  const next: FixedPointState = { format, raw: result.value };
  const decoded = decode(next);

  // docs/NUMERICS.md §7: the operation's own error is measured against what the
  // already-represented inputs imply. For fixed-point addition that is exactly
  // zero unless the sum left the register's range.
  const idealFromRepresentedInputs = add(decode(state), decodedOperand);
  const operationError = sub(decoded, idealFromRepresentedInputs);

  const write: FixedPointAdd = {
    status: result.status,
    state: next,
    decoded,
    operandQuantizationError,
    operationError,
  };
  return result.status === 'stored' ? write : { ...write, overflow: result.overflow };
}

/** Half an LSB — the quantization bound under nearest rounding. */
export function halfLsb(format: FixedPointFormat): Rational {
  return pow2(-(format.fractionBits + 1));
}

export function isWithinHalfLsb(format: FixedPointFormat, error: Rational): boolean {
  const bound = halfLsb(format);
  const magnitude = abs(error);
  return magnitude.numerator * bound.denominator <= bound.numerator * magnitude.denominator;
}

/* -------------------------------------------------------------------------- */
/* Inspection and serialization                                                */
/* -------------------------------------------------------------------------- */

export function rawHex(state: FixedPointState): string {
  return toHex(state.format.widthBits, state.raw);
}

export function rawBinary(state: FixedPointState): string {
  return toBinary(state.format.widthBits, state.raw);
}

export interface FixedPointJSON {
  rawHex: string;
  signed: true;
  integerBits: number;
  fractionBits: number;
}

export function toJSON(state: FixedPointState): FixedPointJSON {
  return {
    rawHex: rawHex(state),
    signed: true,
    integerBits: integerBits(state.format),
    fractionBits: state.format.fractionBits,
  };
}

export function fromJSON(json: FixedPointJSON): FixedPointState {
  const format: FixedPointFormat = {
    widthBits: json.integerBits + json.fractionBits,
    fractionBits: json.fractionBits,
  };
  return { format, raw: fromHex(format.widthBits, json.rawHex) };
}
