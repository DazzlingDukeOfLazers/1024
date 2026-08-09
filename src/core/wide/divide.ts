/**
 * `DIV_REM A, B → quotient Q, remainder R`, holding `A = Q × B + R`.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §9–§12.
 *
 * The contract is the one §9 insists on: the remainder is not a failure and not
 * an error term. It is exact information about what did not fit in the quotient,
 * it is returned as a first-class result, and it is never quietly added back in.
 * A caller that wants more precision asks for more quotient digits (§12) rather
 * than being handed a rounded answer and an apology.
 *
 * The division is genuinely digit-serial — shift, compare, subtract, one
 * quotient bit at a time — because §10's whole claim is that no dedicated wide
 * divider is required by the architectural contract, and a simulator that called
 * the language's `/` would be measuring nothing. `a / b` appears in the tests, as
 * the oracle it is checked against, and nowhere here.
 *
 * §10 also says not to lock the project to one algorithm before benchmarks
 * exist. This implements restoring radix-2 and names it in the result;
 * non-restoring, radix-2^N and reciprocal-based are left open, and the shape of
 * `DivisionState` is meant to hold any of them.
 */

import { WideError, bitLength } from './digits';

export type DivisionAlgorithm = 'restoring-radix-2';

export interface DivisionCosts {
  readonly cyclesPerShift?: number;
  readonly cyclesPerCompare?: number;
  readonly cyclesPerSubtract?: number;
}

export interface DivRemRequest extends DivisionCosts {
  readonly dividend: bigint;
  readonly divisor: bigint;
  /**
   * §11. The numerator is scaled by `2^fractionBits` before dividing, so the
   * quotient carries that many fraction bits and the invariant reads
   * `A × 2^F = Q × B + R`.
   */
  readonly fractionBits?: number;
  readonly algorithm?: DivisionAlgorithm;
}

/** §20, for division. */
export interface DivisionMetrics {
  readonly algorithm: DivisionAlgorithm;
  readonly quotientDigitsGenerated: number;
  readonly shiftOperations: number;
  readonly compareOperations: number;
  readonly subtractOperations: number;
  readonly significantWidthDividend: number;
  readonly significantWidthDivisor: number;
  readonly modeledCycles: number;
}

export interface DivRemResult {
  readonly quotient: bigint;
  /**
   * `dividend × 2^fractionBits − quotient × divisor`. Takes the sign of the
   * dividend, so the invariant holds for signed values as written.
   */
  readonly remainder: bigint;
  /** True when the remainder is zero: the division terminated. */
  readonly exact: boolean;
  readonly fractionBits: number;
  readonly metrics: DivisionMetrics;
  /** Enough to continue from, per §12. */
  readonly state: DivisionState;
}

/** What `refine` needs to generate more quotient digits without starting over. */
export interface DivisionState {
  readonly quotientMagnitude: bigint;
  readonly remainderMagnitude: bigint;
  readonly divisorMagnitude: bigint;
  readonly negativeQuotient: boolean;
  readonly negativeRemainder: boolean;
  readonly fractionBits: number;
  readonly metrics: DivisionMetrics;
  readonly costs: Required<DivisionCosts>;
}

const DEFAULT_COSTS: Required<DivisionCosts> = {
  cyclesPerShift: 1,
  cyclesPerCompare: 1,
  cyclesPerSubtract: 1,
};

function cyclesOf(metrics: Omit<DivisionMetrics, 'modeledCycles'>, costs: Required<DivisionCosts>) {
  return (
    metrics.shiftOperations * costs.cyclesPerShift +
    metrics.compareOperations * costs.cyclesPerCompare +
    metrics.subtractOperations * costs.cyclesPerSubtract
  );
}

export function divRem(request: DivRemRequest): DivRemResult {
  const {
    dividend,
    divisor,
    fractionBits = 0,
    algorithm = 'restoring-radix-2',
    ...costOverrides
  } = request;

  if (divisor === 0n) throw new WideError('DIV_REM by zero has no quotient and no remainder');
  if (fractionBits < 0) throw new WideError('fractionBits cannot be negative');

  const costs = { ...DEFAULT_COSTS, ...costOverrides };
  const negativeQuotient = dividend < 0n !== divisor < 0n;
  const negativeRemainder = dividend < 0n;

  // §11: scale the numerator, then divide magnitudes.
  const scaled = (dividend < 0n ? -dividend : dividend) << BigInt(fractionBits);
  const divisorMagnitude = divisor < 0n ? -divisor : divisor;

  let remainder = 0n;
  let quotient = 0n;
  let shifts = 0;
  let compares = 0;
  let subtracts = 0;

  // Restoring radix-2: bring down one bit, compare, subtract if it fits. This is
  // the SHIFT / COMPARE / SUBTRACT loop §10 describes, and the cost of a wide
  // division in this architecture is the length of it.
  const bits = bitLength(scaled);
  for (let index = bits - 1; index >= 0; index -= 1) {
    remainder = (remainder << 1n) | ((scaled >> BigInt(index)) & 1n);
    quotient <<= 1n;
    shifts += 1;
    compares += 1;
    if (remainder >= divisorMagnitude) {
      remainder -= divisorMagnitude;
      quotient |= 1n;
      subtracts += 1;
    }
  }

  const partial = {
    algorithm,
    quotientDigitsGenerated: bits,
    shiftOperations: shifts,
    compareOperations: compares,
    subtractOperations: subtracts,
    significantWidthDividend: bitLength(scaled),
    significantWidthDivisor: bitLength(divisorMagnitude),
  };
  const metrics: DivisionMetrics = { ...partial, modeledCycles: cyclesOf(partial, costs) };

  return {
    quotient: negativeQuotient ? -quotient : quotient,
    remainder: negativeRemainder ? -remainder : remainder,
    exact: remainder === 0n,
    fractionBits,
    metrics,
    state: {
      quotientMagnitude: quotient,
      remainderMagnitude: remainder,
      divisorMagnitude,
      negativeQuotient,
      negativeRemainder,
      fractionBits,
      metrics,
      costs,
    },
  };
}

/**
 * §12. Generate more quotient digits from the remainder that is already there.
 *
 * `R <<= 1; another quotient bit` per extra fraction bit, which is why execution
 * time scales with the precision asked for rather than being fixed by the
 * format. This is what makes "give me another 64 bits" a real request and not a
 * re-computation.
 */
export function refine(previous: DivRemResult, additionalFractionBits: number): DivRemResult {
  if (additionalFractionBits < 0) throw new WideError('cannot refine by a negative width');
  const state = previous.state;

  let remainder = state.remainderMagnitude;
  let quotient = state.quotientMagnitude;
  let shifts = 0;
  let compares = 0;
  let subtracts = 0;

  for (let step = 0; step < additionalFractionBits; step += 1) {
    remainder <<= 1n;
    quotient <<= 1n;
    shifts += 1;
    compares += 1;
    if (remainder >= state.divisorMagnitude) {
      remainder -= state.divisorMagnitude;
      quotient |= 1n;
      subtracts += 1;
    }
  }

  const fractionBits = state.fractionBits + additionalFractionBits;
  const partial = {
    algorithm: state.metrics.algorithm,
    quotientDigitsGenerated: state.metrics.quotientDigitsGenerated + additionalFractionBits,
    shiftOperations: state.metrics.shiftOperations + shifts,
    compareOperations: state.metrics.compareOperations + compares,
    subtractOperations: state.metrics.subtractOperations + subtracts,
    significantWidthDividend: state.metrics.significantWidthDividend,
    significantWidthDivisor: state.metrics.significantWidthDivisor,
  };
  const metrics: DivisionMetrics = { ...partial, modeledCycles: cyclesOf(partial, state.costs) };

  return {
    quotient: state.negativeQuotient ? -quotient : quotient,
    remainder: state.negativeRemainder ? -remainder : remainder,
    exact: remainder === 0n,
    fractionBits,
    metrics,
    state: {
      ...state,
      quotientMagnitude: quotient,
      remainderMagnitude: remainder,
      fractionBits,
      metrics,
    },
  };
}

/**
 * §12's "continue until exact", with the cap that makes it safe to ask.
 *
 * A quotient that never terminates — one third, in binary — would otherwise run
 * forever, so the caller says how much patience it has and is told whether the
 * answer arrived or the budget did.
 */
export function divideUntilExact(
  request: DivRemRequest & { readonly maxFractionBits: number },
): DivRemResult {
  const { maxFractionBits, ...rest } = request;
  let result = divRem(rest);
  while (!result.exact && result.fractionBits < maxFractionBits) {
    const step = Math.min(64, maxFractionBits - result.fractionBits);
    result = refine(result, step);
  }
  return result;
}
