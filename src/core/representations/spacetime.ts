/**
 * The 1024-bit spacetime frames.
 *
 * Both machines spend exactly 1024 bits on a spacetime coordinate, and spend
 * them very differently:
 *
 *     PlanckInt256   X:256  Y:256  Z:256  T:256   integer Planck ticks
 *     Q128.128 @ B   X:256  Y:256  Z:256 CT:256   fixed point, configurable ruler
 *
 * The fourth coordinate of the metric frame is `ct`, not raw seconds, so all
 * four axes carry the same physical dimension and the register is geometrically
 * homogeneous (PROJECT_SPEC §3). Because `c` is exact by SI definition the
 * conversion introduces no error of its own.
 *
 * Display may still show time as seconds, light-distance or Planck times.
 * Storage does not change.
 */

import { type Rational, div, mul } from '../rational/rational';
import { SPEED_OF_LIGHT } from './constants';
import { type FixedPointState } from './fixedPoint';
import { PLANCK_REGISTER_WIDTH, type PlanckState, zeroTicks } from './planck';
import { type Q128_128Config, q128State } from './q128_128';

export const SPACETIME_TOTAL_BITS = 1024;

/** `ct = c × t`, exactly. */
export function ctMetersFromSeconds(seconds: Rational): Rational {
  return mul(seconds, SPEED_OF_LIGHT.nominal);
}

/** Inverse of {@link ctMetersFromSeconds}, also exact. */
export function secondsFromCtMeters(ctMeters: Rational): Rational {
  return div(ctMeters, SPEED_OF_LIGHT.nominal);
}

/** Four Q128.128 registers under one base-unit configuration. */
export interface MetricSpacetimeRegister {
  config: Q128_128Config;
  x: FixedPointState;
  y: FixedPointState;
  z: FixedPointState;
  /** ct, in the same configured length base unit as x/y/z. */
  ct: FixedPointState;
}

export function createMetricSpacetime(config: Q128_128Config): MetricSpacetimeRegister {
  return { config, x: q128State(), y: q128State(), z: q128State(), ct: q128State() };
}

/** Four 256-bit integer registers of Planck ticks. */
export interface PlanckSpacetimeRegister {
  x: PlanckState;
  y: PlanckState;
  z: PlanckState;
  /** Planck times, not Planck lengths — this axis uses the other constant. */
  t: PlanckState;
}

export function createPlanckSpacetime(): PlanckSpacetimeRegister {
  return { x: zeroTicks(), y: zeroTicks(), z: zeroTicks(), t: zeroTicks() };
}

export function totalBits(register: MetricSpacetimeRegister | PlanckSpacetimeRegister): number {
  return 'config' in register ? register.x.format.widthBits * 4 : PLANCK_REGISTER_WIDTH * 4;
}
