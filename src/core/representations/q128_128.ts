/**
 * The Q128.128 metric spacetime machine.
 *
 * docs/NUMERICS.md §5. Each coordinate is a signed 256-bit fixed-point register
 * with 128 fraction bits, and the **machine base unit** `B` is configurable:
 *
 *     decoded SI metres = raw × B / 2^128
 *
 * Same 256 bits. Pick your ruler. A smaller base unit buys resolution and
 * spends range; a larger one does the reverse.
 *
 * The machine base unit is not the display unit. Changing how a value is shown
 * must never touch machine state — see `core/units/format.ts` for display.
 */

import {
  type Rational,
  type RoundingMode,
  ONE,
  div,
  mul,
  pow10,
  rational,
  sub,
} from '../rational/rational';
import { type OverflowMode } from './integers';
import {
  type FixedPointAdd,
  type FixedPointState,
  type FixedPointWrite,
  Q128_128,
  addExact,
  decode as decodeMachineUnits,
  encode as encodeMachineUnits,
  halfLsb,
  lsb,
  maxValue,
  minValue,
  zeroState,
} from './fixedPoint';

export interface Q128_128Config {
  /** Exact metres per machine unit. */
  baseUnitMeters: Rational;
  /** Label for the machine's base unit, e.g. `mm`. Not a display setting. */
  baseUnitLabel: string;
  rounding: RoundingMode;
  overflow: OverflowMode;
}

function preset(baseUnitLabel: string, baseUnitMeters: Rational): Q128_128Config {
  return { baseUnitMeters, baseUnitLabel, rounding: 'nearest-even', overflow: 'checked' };
}

export const Q128_128_PRESETS = {
  mm: preset('mm', pow10(-3)),
  m: preset('m', ONE),
  km: preset('km', pow10(3)),
  Mm: preset('Mm', pow10(6)),
} as const;

export type Q128_128PresetName = keyof typeof Q128_128_PRESETS;

/** The default machine: Q128.128 @ m. */
export const DEFAULT_Q128_128_CONFIG: Q128_128Config = Q128_128_PRESETS.m;

export const Q128_128_FORMAT = Q128_128;

export function q128State(): FixedPointState {
  return zeroState(Q128_128);
}

/* -------------------------------------------------------------------------- */
/* Physical characterisation                                                   */
/* -------------------------------------------------------------------------- */

/** Physical size of one LSB, in metres: `B / 2^128`. */
export function physicalLsbMeters(config: Q128_128Config): Rational {
  return mul(lsb(Q128_128), config.baseUnitMeters);
}

export function physicalRangeMeters(config: Q128_128Config): { min: Rational; max: Rational } {
  return {
    min: mul(minValue(Q128_128), config.baseUnitMeters),
    max: mul(maxValue(Q128_128), config.baseUnitMeters),
  };
}

/** Half an LSB in metres — the quantization bound under nearest rounding. */
export function halfLsbMeters(config: Q128_128Config): Rational {
  return mul(halfLsb(Q128_128), config.baseUnitMeters);
}

export interface Q128_128Summary {
  baseUnitLabel: string;
  baseUnitMeters: Rational;
  widthBits: number;
  fractionBits: number;
  lsbMeters: Rational;
  minMeters: Rational;
  maxMeters: Rational;
}

/** The data behind the "Same 256 bits. Pick your ruler." panel. */
export function summarize(config: Q128_128Config): Q128_128Summary {
  const range = physicalRangeMeters(config);
  return {
    baseUnitLabel: config.baseUnitLabel,
    baseUnitMeters: config.baseUnitMeters,
    widthBits: Q128_128.widthBits,
    fractionBits: Q128_128.fractionBits,
    lsbMeters: physicalLsbMeters(config),
    minMeters: range.min,
    maxMeters: range.max,
  };
}

/* -------------------------------------------------------------------------- */
/* Encoding and decoding                                                       */
/* -------------------------------------------------------------------------- */

/** Exact metres held by a register under this configuration. */
export function decodeMeters(config: Q128_128Config, state: FixedPointState): Rational {
  return mul(decodeMachineUnits(state), config.baseUnitMeters);
}

export interface Q128_128Write extends FixedPointWrite {
  /** Exact metres now held. Absent when a checked write was refused. */
  decodedMeters?: Rational;
  /** `decodedMeters - requested metres`. Absent when refused. */
  quantizationErrorMeters?: Rational;
}

export function encodeMeters(config: Q128_128Config, meters: Rational): Q128_128Write {
  const machineUnits = div(meters, config.baseUnitMeters);
  const write = encodeMachineUnits(Q128_128, machineUnits, config.rounding, config.overflow);
  if (write.state === undefined || write.decoded === undefined) {
    return write;
  }
  const decodedMeters = mul(write.decoded, config.baseUnitMeters);
  return {
    ...write,
    decodedMeters,
    quantizationErrorMeters: sub(decodedMeters, meters),
  };
}

export interface Q128_128Add extends FixedPointAdd {
  decodedMeters?: Rational;
  operandQuantizationErrorMeters: Rational;
  operationErrorMeters?: Rational;
}

/**
 * Add an exact number of metres. The operand is quantized to the machine's
 * grid; the integer addition that follows is exact.
 */
export function addMeters(
  config: Q128_128Config,
  state: FixedPointState,
  meters: Rational,
): Q128_128Add {
  const result = addExact(
    state,
    div(meters, config.baseUnitMeters),
    config.rounding,
    config.overflow,
  );
  const operandQuantizationErrorMeters = mul(
    result.operandQuantizationError,
    config.baseUnitMeters,
  );

  if (result.state === undefined || result.decoded === undefined) {
    return { ...result, operandQuantizationErrorMeters };
  }
  const converted: Q128_128Add = {
    ...result,
    decodedMeters: mul(result.decoded, config.baseUnitMeters),
    operandQuantizationErrorMeters,
  };
  return result.operationError === undefined
    ? converted
    : { ...converted, operationErrorMeters: mul(result.operationError, config.baseUnitMeters) };
}

/** True when `meters` lands exactly on this machine's grid. */
export function isExactlyRepresentable(config: Q128_128Config, meters: Rational): boolean {
  const scaled = mul(div(meters, config.baseUnitMeters), rational(2n ** 128n));
  return scaled.denominator === 1n;
}
