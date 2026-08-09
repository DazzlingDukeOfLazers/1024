/**
 * The Q512.512 finite 1024-bit error meter.
 *
 * docs/NUMERICS.md §6:
 *
 *     decoded = raw / 2^512, in the quantity's canonical SI unit
 *
 * This is a **finite simulated machine**, not the exact reference. It is
 * deliberately possible for it to quantize or overflow, and when it does that
 * fact is itself a result worth showing: a finite meter measuring finite error
 * has its own error.
 *
 * Every simulated representation owns its own pair of these. There is no global
 * error bucket.
 */

import { type Rational, abs } from '../rational/rational';
import { type OverflowEvent, type OverflowMode } from './integers';
import {
  type FixedPointState,
  Q512_512,
  addExact,
  decode,
  halfLsb,
  lsb,
  maxValue,
  minValue,
  zeroState,
} from './fixedPoint';

export const Q512_512_FORMAT = Q512_512;

export function createAccumulator(): FixedPointState {
  return zeroState(Q512_512);
}

/** Smallest error this meter can register, in canonical SI units: 2^-512. */
export function accumulatorLsb(): Rational {
  return lsb(Q512_512);
}

export function accumulatorHalfLsb(): Rational {
  return halfLsb(Q512_512);
}

export function accumulatorRange(): { min: Rational; max: Rational } {
  return { min: minValue(Q512_512), max: maxValue(Q512_512) };
}

/** Exact value the meter currently reads. */
export function readAccumulator(state: FixedPointState): Rational {
  return decode(state);
}

export interface AccumulateResult {
  state: FixedPointState;
  /** Error the meter itself introduced storing this contribution. */
  meterQuantizationError: Rational;
  overflow?: OverflowEvent;
}

/**
 * Add one error contribution to the meter.
 *
 * The meter saturates by default. A refused write would silently drop the
 * contribution, which is worse than a visible pinned reading — and the overflow
 * event is always reported either way.
 */
export function accumulate(
  state: FixedPointState,
  contribution: Rational,
  overflow: OverflowMode = 'saturate',
): AccumulateResult {
  const result = addExact(state, contribution, 'nearest-even', overflow);
  return {
    // A refused write leaves the meter where it was; the event says why.
    state: result.state ?? state,
    meterQuantizationError: result.operandQuantizationError,
    ...(result.overflow === undefined ? {} : { overflow: result.overflow }),
  };
}

/** Add the magnitude of a contribution, for the absolute-error meter. */
export function accumulateAbsolute(
  state: FixedPointState,
  contribution: Rational,
  overflow: OverflowMode = 'saturate',
): AccumulateResult {
  return accumulate(state, abs(contribution), overflow);
}
