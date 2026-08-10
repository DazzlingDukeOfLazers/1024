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
 * exist. Four are implemented and named in the result — restoring and
 * non-restoring radix-2, and restoring radix-4 and radix-8 — so the choice is
 * made against measurements. Reciprocal-based division is still open, and the
 * shape of `DivisionState` is meant to hold it too.
 */

import { WideError, bitLength } from './digits';

/**
 * §10 lists several, and says not to lock the project to one before benchmarks
 * exist. Four are implemented; they must agree on every answer and are free to
 * disagree about the work, which is the only reason to have more than one.
 */
export const DIVISION_ALGORITHMS = [
  'restoring-radix-2',
  'non-restoring-radix-2',
  'restoring-radix-4',
  'restoring-radix-8',
] as const;
export type DivisionAlgorithm = (typeof DIVISION_ALGORITHMS)[number];

/** Bits of quotient produced per iteration, by name. */
const RADIX_BITS: Record<DivisionAlgorithm, number> = {
  'restoring-radix-2': 1,
  'non-restoring-radix-2': 1,
  'restoring-radix-4': 2,
  'restoring-radix-8': 3,
};

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
  /**
   * Record the state after every quotient bit. §22 asks for the quotient digits
   * and the remainder to be animated, which needs the intermediate states rather
   * than the answer, and off by default because a 1024-bit division has a
   * thousand of them and almost every caller wants none.
   */
  readonly trace?: boolean;
}

/**
 * One quotient bit, and what the machine held after producing it.
 *
 * The loop invariant is the headline identity narrowed to the part of the
 * dividend seen so far: `consumed = quotient × divisor + remainder`. §22 asks
 * for `A = Q × B + R` to be displayed continuously, and this is what makes that
 * a true statement at every frame rather than only at the end.
 */
export interface DivisionStep {
  /** Bit position of the scaled dividend consumed by this step. */
  readonly index: number;
  /** The quotient bits the machine has actually recorded. */
  readonly quotient: bigint;
  /**
   * The quotient value the identity holds for: `consumed = quotientSoFar ×
   * divisor + remainder`.
   *
   * Under restoring division this is the recorded bits, unchanged. Under
   * non-restoring it is not, and the difference is worth stating rather than
   * papering over. Non-restoring records bit `k` from the sign of `R_k`, so the
   * bits lag the signed digits `±1` by one step; the identity holds for the
   * signed-digit accumulation, which is why the algorithm needs a correction at
   * the end and the restoring one does not. Displaying `quotient` against the
   * identity would show it broken at every intermediate step of a correct
   * division.
   */
  readonly quotientSoFar: bigint;
  /**
   * Remainder held after this step. Non-negative under restoring division;
   * under non-restoring it is allowed to go negative, which is the whole point
   * of the algorithm and is visible here rather than hidden.
   */
  readonly remainder: bigint;
  /** The high bits of the scaled dividend consumed so far. */
  readonly consumed: bigint;
  /** The quotient digit this step produced, in `0 .. 2^digitBits − 1`. */
  readonly digit: bigint;
  /** How many quotient bits this step produced. */
  readonly digitBits: number;
}

/** §20, for division. */
export interface DivisionMetrics {
  readonly algorithm: DivisionAlgorithm;
  readonly quotientDigitsGenerated: number;
  readonly shiftOperations: number;
  readonly compareOperations: number;
  readonly subtractOperations: number;
  /**
   * Additions spent building the table of divisor multiples before the loop
   * starts. Zero below radix 4, and `radix − 2` above it — separate from
   * `subtractOperations` because it is the price of the radix rather than work
   * the division does, and burying it there would hide the whole trade.
   */
  readonly tableOperations: number;
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
  /** Present only when the request asked for it. */
  readonly steps?: readonly DivisionStep[];
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
    metrics.subtractOperations * costs.cyclesPerSubtract +
    // An addition and a subtraction cost the same thing, so the table is priced
    // as the additions it is.
    metrics.tableOperations * costs.cyclesPerSubtract
  );
}

interface Digits {
  readonly remainder: bigint;
  readonly quotient: bigint;
  readonly shifts: number;
  readonly compares: number;
  readonly subtracts: number;
  readonly tableOps: number;
}

/**
 * Bring down `digitBits` bits, choose the largest multiple of the divisor that
 * fits, subtract it. The SHIFT / COMPARE / SUBTRACT loop §10 describes, with the
 * radix left open.
 *
 * At `digitBits = 1` this *is* the plain restoring algorithm: the table is
 * `[0, B]`, the search is one comparison, and the digit is a bit. The higher
 * radices are the same loop taking bigger bites, which is the point — §10 lists
 * radix-2^N as an alternative rather than a different machine, and writing it as
 * a separate function would have made that a claim instead of a fact.
 *
 * Digit selection is a binary search over the table, so it costs exactly
 * `digitBits` comparisons whatever the radix — the same comparisons per *bit* as
 * radix-2. What the radix buys is iterations: one shift and at most one subtract
 * per digit instead of per bit. What it costs is `radix − 2` additions to build
 * the table before any of that starts. Whether that trades well is a question
 * about the size of the division, and is measured rather than assumed.
 */
function restoringRadix(
  scaled: bigint,
  divisor: bigint,
  bits: number,
  digitBits: number,
  trace?: DivisionStep[],
): Digits {
  const radix = 1 << digitBits;
  const mask = BigInt(radix - 1);
  const wide = BigInt(digitBits);

  // multiples[i] = i × divisor, built by repeated addition because a machine
  // without a wide multiplier does not get to write `i * divisor` either.
  const multiples: bigint[] = [0n, divisor];
  for (let i = 2; i < radix; i += 1) multiples.push(multiples[i - 1]! + divisor);
  const tableOps = Math.max(0, radix - 2);

  let remainder = 0n;
  let quotient = 0n;
  let consumed = 0n;
  let compares = 0;
  let subtracts = 0;
  let shifts = 0;

  const digits = Math.ceil(bits / digitBits);
  for (let step = digits - 1; step >= 0; step -= 1) {
    const index = step * digitBits;
    const digit = (scaled >> BigInt(index)) & mask;
    remainder = (remainder << wide) | digit;
    shifts += 1;

    // Largest q with q × divisor ≤ remainder. `multiples[0]` is zero and the
    // remainder is never negative here, so the search always has an answer.
    let low = 0;
    let high = radix - 1;
    while (low < high) {
      // The `+ 1` is what makes this terminate, and it reads like an off-by-one
      // to be tidied away. With it, `middle` lands in `(low, high]`, so the
      // `low = middle` branch strictly increases `low`; without it `middle` can
      // equal `low` and that branch makes no progress at all. Removing it does
      // not produce a wrong answer — it produces a division that never returns.
      const middle = (low + high + 1) >> 1;
      compares += 1;
      if (multiples[middle]! <= remainder) low = middle;
      else high = middle - 1;
    }
    if (low > 0) {
      remainder -= multiples[low]!;
      subtracts += 1;
    }
    quotient = quotient * BigInt(radix) + BigInt(low);

    if (trace !== undefined) {
      consumed = (consumed << wide) | digit;
      trace.push({
        index,
        quotient,
        quotientSoFar: quotient,
        remainder,
        consumed,
        digit: BigInt(low),
        digitBits,
      });
    }
  }
  return { remainder, quotient, shifts, compares, subtracts, tableOps };
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
function nonRestoring(
  scaled: bigint,
  divisor: bigint,
  bits: number,
  trace?: DivisionStep[],
): Digits {
  let remainder = 0n;
  let quotient = 0n;
  let consumed = 0n;
  // The signed-digit quotient the loop invariant is stated over: one ±1 digit
  // per step, chosen by the sign of the *previous* remainder. Only tracked when
  // someone is watching, since nothing but the trace needs it.
  let signed = 0n;
  let addsAndSubtracts = 0;

  for (let index = bits - 1; index >= 0; index -= 1) {
    const negative = remainder < 0n;
    const bit = (scaled >> BigInt(index)) & 1n;
    remainder = (remainder << 1n) | bit;
    remainder = negative ? remainder + divisor : remainder - divisor;
    addsAndSubtracts += 1;

    quotient <<= 1n;
    if (remainder >= 0n) quotient |= 1n;
    if (trace !== undefined) {
      consumed = (consumed << 1n) | bit;
      signed = signed * 2n + (negative ? -1n : 1n);
      trace.push({
        index,
        quotient,
        quotientSoFar: signed,
        remainder,
        consumed,
        digit: quotient & 1n,
        digitBits: 1,
      });
    }
  }

  // The correction that pays for never having restored.
  let corrections = 0;
  if (remainder < 0n) {
    remainder += divisor;
    corrections = 1;
    if (trace !== undefined) {
      const last = trace[trace.length - 1];
      if (last !== undefined) {
        // Adding the divisor back moves one unit out of the quotient and into
        // the remainder, so the identity survives the correction: it is the same
        // equation with `Q − 1` and `R + B`.
        trace.push({ ...last, index: -1, remainder, quotientSoFar: last.quotientSoFar - 1n });
      }
    }
  }

  return {
    remainder,
    quotient,
    shifts: bits,
    // A sign test rather than a magnitude comparison, which is the saving.
    compares: 0,
    subtracts: addsAndSubtracts + corrections,
    tableOps: 0,
  };
}

export function divRem(request: DivRemRequest): DivRemResult {
  const {
    dividend,
    divisor,
    fractionBits = 0,
    algorithm = 'restoring-radix-2',
    trace: wantTrace = false,
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
  const steps = wantTrace ? [] : undefined;
  const { remainder, quotient, shifts, compares, subtracts, tableOps } =
    algorithm === 'non-restoring-radix-2'
      ? nonRestoring(scaled, divisorMagnitude, bits, steps)
      : restoringRadix(scaled, divisorMagnitude, bits, RADIX_BITS[algorithm], steps);

  const partial = {
    algorithm,
    quotientDigitsGenerated: bits,
    shiftOperations: shifts,
    compareOperations: compares,
    subtractOperations: subtracts,
    tableOperations: tableOps,
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
    ...(steps === undefined ? {} : { steps }),
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
    // The continuation is radix-2, so it builds no table of its own; the one
    // the leading digits paid for is still what was paid.
    tableOperations: state.metrics.tableOperations,
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
