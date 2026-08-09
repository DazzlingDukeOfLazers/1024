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

/**
 * §10 lists several, and says not to lock the project to one before benchmarks
 * exist. Two are implemented; they must agree on every answer and are free to
 * disagree about the work, which is the only reason to have both.
 */
export const DIVISION_ALGORITHMS = ['restoring-radix-2', 'non-restoring-radix-2'] as const;
export type DivisionAlgorithm = (typeof DIVISION_ALGORITHMS)[number];

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

interface Digits {
  readonly remainder: bigint;
  readonly quotient: bigint;
  readonly shifts: number;
  readonly compares: number;
  readonly subtracts: number;
}

/**
 * Bring down one bit, compare, subtract if it fits, and put it back if it does
 * not. The SHIFT / COMPARE / SUBTRACT loop §10 describes, in its plainest form.
 */
function restoring(scaled: bigint, divisor: bigint, bits: number): Digits {
  let remainder = 0n;
  let quotient = 0n;
  let subtracts = 0;

  for (let index = bits - 1; index >= 0; index -= 1) {
    remainder = (remainder << 1n) | ((scaled >> BigInt(index)) & 1n);
    quotient <<= 1n;
    if (remainder >= divisor) {
      remainder -= divisor;
      quotient |= 1n;
      subtracts += 1;
    }
  }
  return { remainder, quotient, shifts: bits, compares: bits, subtracts };
}

/**
 * Subtract unconditionally and let the remainder go negative, adding the divisor
 * back on the next step instead of undoing the subtraction on this one.
 *
 * The trade §10 wants measured: one add-or-subtract every step and no magnitude
 * comparison at all — the decision is a sign bit — against one final correction
 * when the last remainder came out negative. Whether that is cheaper depends on
 * what a comparison costs relative to an addition, which is why both are here
 * and why the costs are parameters.
 */
function nonRestoring(scaled: bigint, divisor: bigint, bits: number): Digits {
  let remainder = 0n;
  let quotient = 0n;
  let addsAndSubtracts = 0;

  for (let index = bits - 1; index >= 0; index -= 1) {
    const negative = remainder < 0n;
    remainder = (remainder << 1n) | ((scaled >> BigInt(index)) & 1n);
    remainder = negative ? remainder + divisor : remainder - divisor;
    addsAndSubtracts += 1;

    quotient <<= 1n;
    if (remainder >= 0n) quotient |= 1n;
  }

  // The correction that pays for never having restored.
  let corrections = 0;
  if (remainder < 0n) {
    remainder += divisor;
    corrections = 1;
  }

  return {
    remainder,
    quotient,
    shifts: bits,
    // A sign test rather than a magnitude comparison, which is the saving.
    compares: 0,
    subtracts: addsAndSubtracts + corrections,
  };
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

  const bits = bitLength(scaled);
  const { remainder, quotient, shifts, compares, subtracts } =
    algorithm === 'restoring-radix-2'
      ? restoring(scaled, divisorMagnitude, bits)
      : nonRestoring(scaled, divisorMagnitude, bits);

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
 *
 * The continuation is restoring whichever algorithm produced the state, which is
 * sound rather than lazy: both leave the remainder in `[0, divisor)` — the
 * non-restoring one after its final correction — and that is exactly the
 * invariant a restoring step needs. The metrics still name the algorithm that
 * generated the leading digits.
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
