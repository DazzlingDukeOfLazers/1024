/**
 * The Planck-grid spacetime machine.
 *
 * docs/NUMERICS.md §4. Four 256-bit signed integer registers, 1024 bits total:
 *
 *     X/Y/Z raw unit = declared nominal Planck length
 *     T     raw unit = declared nominal Planck time
 *
 * This is a **representation thought experiment**, not a claim that spacetime
 * is discrete. Its educational purpose is bit width and fixed absolute
 * resolution: if you chose Planck units as the LSB, how many bits would you
 * need? The answer — 256 per axis is absurdly more than the observable universe
 * requires — is the joke the project is built on.
 *
 * Quantization here is conditioned on the declared nominal constant. The
 * constant's measurement uncertainty is a separate concern and never enters an
 * ErrorLedger (docs/NUMERICS.md §3).
 */

import {
  type Rational,
  type RoundingMode,
  div,
  mul,
  rational,
  roundToBigInt,
  sub,
} from '../rational/rational';
import {
  type OverflowEvent,
  type OverflowMode,
  signedMax,
  signedMin,
  storeSigned,
} from './integers';
import { type ConstantSet, CODATA_2018, type DeclaredConstant } from './constants';

/** One spatial or temporal coordinate of the Planck machine. */
export const PLANCK_REGISTER_WIDTH = 256;

export interface PlanckConfig {
  constants: ConstantSet;
  rounding: RoundingMode;
  overflow: OverflowMode;
}

export const DEFAULT_PLANCK_CONFIG: PlanckConfig = {
  constants: CODATA_2018,
  rounding: 'nearest-even',
  overflow: 'checked',
};

export interface PlanckState {
  /** Signed count of LSBs. One tick is one nominal Planck length or time. */
  ticks: bigint;
}

export function zeroTicks(): PlanckState {
  return { ticks: 0n };
}

/* -------------------------------------------------------------------------- */
/* Physical characterisation                                                   */
/* -------------------------------------------------------------------------- */

export interface PlanckAxisSummary {
  constant: DeclaredConstant;
  widthBits: number;
  /** Absolute resolution: one tick, in the constant's SI unit. */
  lsb: Rational;
  min: Rational;
  max: Rational;
}

export function summarizeAxis(constant: DeclaredConstant): PlanckAxisSummary {
  return {
    constant,
    widthBits: PLANCK_REGISTER_WIDTH,
    lsb: constant.nominal,
    min: mul(rational(signedMin(PLANCK_REGISTER_WIDTH)), constant.nominal),
    max: mul(rational(signedMax(PLANCK_REGISTER_WIDTH)), constant.nominal),
  };
}

export function summarizeLength(config: PlanckConfig = DEFAULT_PLANCK_CONFIG): PlanckAxisSummary {
  return summarizeAxis(config.constants.planckLength);
}

export function summarizeTime(config: PlanckConfig = DEFAULT_PLANCK_CONFIG): PlanckAxisSummary {
  return summarizeAxis(config.constants.planckTime);
}

/* -------------------------------------------------------------------------- */
/* Quantization                                                                */
/* -------------------------------------------------------------------------- */

export interface PlanckWrite {
  status: 'stored' | 'wrapped' | 'saturated' | 'rejected';
  state?: PlanckState;
  /** Exact SI value the ticks decode to, given the declared constant. */
  decoded?: Rational;
  /** `decoded - requested`. Quantization to the nominal Planck grid. */
  quantizationError?: Rational;
  overflow?: OverflowEvent;
}

/** Exact SI value of a tick count, given the declared constant. */
export function decodeTicks(constant: DeclaredConstant, state: PlanckState): Rational {
  return mul(rational(state.ticks), constant.nominal);
}

function encodeAgainst(
  constant: DeclaredConstant,
  value: Rational,
  config: PlanckConfig,
): PlanckWrite {
  const exactTicks = div(value, constant.nominal);
  const ticks = roundToBigInt(exactTicks, config.rounding);
  const result = storeSigned(PLANCK_REGISTER_WIDTH, ticks, config.overflow);

  if (result.status === 'rejected') {
    return { status: 'rejected', overflow: result.overflow };
  }
  const state: PlanckState = { ticks: result.value };
  const decoded = decodeTicks(constant, state);
  const write: PlanckWrite = {
    status: result.status,
    state,
    decoded,
    quantizationError: sub(decoded, value),
  };
  return result.status === 'stored' ? write : { ...write, overflow: result.overflow };
}

/** Quantize a length in metres onto the Planck length grid. */
export function encodeMeters(
  value: Rational,
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
): PlanckWrite {
  return encodeAgainst(config.constants.planckLength, value, config);
}

/** Quantize a duration in seconds onto the Planck time grid. */
export function encodeSeconds(
  value: Rational,
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
): PlanckWrite {
  return encodeAgainst(config.constants.planckTime, value, config);
}

/**
 * Express an SI length as a count of nominal Planck lengths, without
 * quantizing. This is the "how many Planck lengths is that?" display path — it
 * answers a question about magnitude, not about a register.
 */
export function metersToPlanckLengths(
  value: Rational,
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
): Rational {
  return div(value, config.constants.planckLength.nominal);
}

export interface PlanckAdd {
  status: 'stored' | 'wrapped' | 'saturated' | 'rejected';
  state?: PlanckState;
  decoded?: Rational;
  /** Error introduced quantizing the operand onto the grid. */
  operandQuantizationError: Rational;
  /** Integer tick addition is exact, so this is zero unless it overflowed. */
  operationError?: Rational;
  overflow?: OverflowEvent;
}

export function addMeters(
  state: PlanckState,
  value: Rational,
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
): PlanckAdd {
  const constant = config.constants.planckLength;
  const operandTicks = roundToBigInt(div(value, constant.nominal), config.rounding);
  const decodedOperand = mul(rational(operandTicks), constant.nominal);
  const operandQuantizationError = sub(decodedOperand, value);

  const result = storeSigned(PLANCK_REGISTER_WIDTH, state.ticks + operandTicks, config.overflow);
  if (result.status === 'rejected') {
    return { status: 'rejected', operandQuantizationError, overflow: result.overflow };
  }

  const next: PlanckState = { ticks: result.value };
  const decoded = decodeTicks(constant, next);
  const operationError = sub(decoded, mul(rational(state.ticks + operandTicks), constant.nominal));

  const write: PlanckAdd = {
    status: result.status,
    state: next,
    decoded,
    operandQuantizationError,
    operationError,
  };
  return result.status === 'stored' ? write : { ...write, overflow: result.overflow };
}
