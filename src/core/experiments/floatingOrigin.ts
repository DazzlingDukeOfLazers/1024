/**
 * The floating-origin / rebasing demonstration.
 *
 * PROJECT_SPEC §7: the point is not merely that finite precision fails. It is
 * that real software preserves useful local precision by changing coordinate
 * strategy. Two positions 1 mm apart around a 1e20 m origin are invisible to
 * absolute binary64 coordinates and perfectly ordinary once the origin is
 * subtracted exactly first (docs/NUMERICS.md §12).
 */

import { type Rational, add, isZero, sub } from '../rational/rational';
import { parseRationalExact } from '../rational/parse';
import { encodeRational, isFiniteState, neighbors, toNumber } from '../representations/binary64';
import { rawFixture } from './fixtures';
import { ExperimentError } from './steps';

export interface FloatingOriginConfig {
  /** Exact origin, in metres. */
  originMeters: Rational;
  /** Exact separation between the two positions, in metres. */
  localOffsetMeters: Rational;
}

export interface StrategyResult {
  /** Exact value binary64 ends up holding for each position. */
  storedA: Rational;
  storedB: Rational;
  /** `storedB - storedA` — what the strategy believes the separation to be. */
  separation: Rational;
  /** True when the strategy lost the separation entirely. */
  separationLost: boolean;
  /** `separation - trueSeparation`. */
  separationError: Rational;
}

export interface FloatingOriginResult {
  originMeters: Rational;
  localOffsetMeters: Rational;
  /** binary64's representable-value spacing at the origin. */
  gapAtOrigin?: Rational;
  /** Both positions stored as absolute binary64 coordinates. */
  absolute: StrategyResult;
  /** The origin subtracted exactly first; only the small local delta becomes a double. */
  rebased: StrategyResult;
  /**
   * What the forbidden `Number(a) - Number(b)` path produces. Computed here
   * only so a test can assert the failure it is meant to prevent; production
   * code must never take this route.
   */
  naiveNumberSeparation: number;
}

function strategy(storedA: Rational, storedB: Rational, trueSeparation: Rational): StrategyResult {
  const separation = sub(storedB, storedA);
  return {
    storedA,
    storedB,
    separation,
    separationLost: isZero(separation) && !isZero(trueSeparation),
    separationError: sub(separation, trueSeparation),
  };
}

/** Encode through binary64 and read back the exact value it stored. */
function throughBinary64(value: Rational): Rational {
  const encoded = encodeRational(value);
  if (!isFiniteState(encoded.state)) {
    throw new ExperimentError('Floating-origin positions must be finite in binary64');
  }
  return encoded.state.exact;
}

export function runFloatingOrigin(config: FloatingOriginConfig): FloatingOriginResult {
  const { originMeters, localOffsetMeters } = config;
  const positionA = originMeters;
  const positionB = add(originMeters, localOffsetMeters);

  // Strategy 1: store the absolute coordinates. The offset is far below the
  // local representable spacing, so it never survives the encoding.
  const absolute = strategy(
    throughBinary64(positionA),
    throughBinary64(positionB),
    localOffsetMeters,
  );

  // Strategy 2: subtract the exact origin first, then convert only the small
  // local delta. Same binary64, same positions, different coordinate strategy.
  const rebased = strategy(
    throughBinary64(sub(positionA, originMeters)),
    throughBinary64(sub(positionB, originMeters)),
    localOffsetMeters,
  );

  const originAsDouble = toNumber(encodeRational(originMeters).state);
  const positionBAsDouble = toNumber(encodeRational(positionB).state);
  const gapAtOrigin = neighbors(originAsDouble).gapAbove;

  return {
    originMeters,
    localOffsetMeters,
    ...(gapAtOrigin === undefined ? {} : { gapAtOrigin }),
    absolute,
    rebased,
    naiveNumberSeparation: positionBAsDouble - originAsDouble,
  };
}

/** The configuration authored in `fixtures/experiments.json`. */
export function builtInFloatingOriginConfig(): FloatingOriginConfig {
  const fixture = rawFixture('floating-origin') as
    | {
        origin?: { numerator: string; denominator: string };
        localOffset?: { numerator: string; denominator: string };
      }
    | undefined;
  if (fixture?.origin === undefined || fixture.localOffset === undefined) {
    throw new ExperimentError('The floating-origin fixture is missing its origin or offset');
  }
  return {
    originMeters: parseRationalExact(`${fixture.origin.numerator}/${fixture.origin.denominator}`),
    localOffsetMeters: parseRationalExact(
      `${fixture.localOffset.numerator}/${fixture.localOffset.denominator}`,
    ),
  };
}
