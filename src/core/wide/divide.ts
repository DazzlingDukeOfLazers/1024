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
 * exist. Every algorithm it lists is implemented now and named in the result:
 * restoring and non-restoring radix-2, restoring radix-4 and radix-8, and the
 * reciprocal method, which leaves the digit-serial family entirely and builds
 * division out of the multiplication the architecture already has.
 *
 * They all agree on every answer and disagree about the work, and the benchmark
 * has no winner in it — which is the finding, not a gap. See the tests.
 */

import { type DigitWidth, WideError, bitLength } from './digits';
import { mulWide } from './multiply';

/**
 * §10 lists several, and says not to lock the project to one before benchmarks
 * exist. All five are implemented; they must agree on every answer and are free
 * to disagree about the work, which is the only reason to have more than one.
 */
export const DIVISION_ALGORITHMS = [
  'restoring-radix-2',
  'non-restoring-radix-2',
  'restoring-radix-4',
  'restoring-radix-8',
  'reciprocal-newton',
] as const;
export type DivisionAlgorithm = (typeof DIVISION_ALGORITHMS)[number];

/** Bits of quotient produced per iteration, by name. */
const RADIX_BITS: Record<DivisionAlgorithm, number> = {
  'restoring-radix-2': 1,
  'non-restoring-radix-2': 1,
  'restoring-radix-4': 2,
  'restoring-radix-8': 3,
  // Not a digit-serial method at all; see `reciprocalNewton`.
  'reciprocal-newton': 0,
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
  /** Digit width of the multiplier the reciprocal method uses. Ignored by the rest. */
  readonly multiplyDigitBits?: DigitWidth;
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
  /**
   * Wide multiplications performed. Zero for every digit-serial algorithm, and
   * the entire cost of the reciprocal one — §10's reason for listing it is that
   * it converts division into the operation the architecture already has.
   */
  readonly multiplyOperations: number;
  /**
   * What those multiplications cost, taken from `mulWide`'s own model rather
   * than invented here. A multiply is not a unit of work, and pricing it as one
   * would make the comparison meaningless.
   */
  readonly multiplyCycles: number;
  /**
   * Widest intermediate the method needed. The digit-serial algorithms never
   * hold more than a remainder; the reciprocal one holds a value about twice the
   * quotient, which is a real cost of the method and not a detail.
   */
  readonly temporaryBits: number;
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
    metrics.tableOperations * costs.cyclesPerSubtract +
    metrics.multiplyCycles
  );
}

interface Digits {
  readonly remainder: bigint;
  readonly quotient: bigint;
  readonly shifts: number;
  readonly compares: number;
  readonly subtracts: number;
  readonly tableOps: number;
  readonly multiplies: number;
  readonly multiplyCycles: number;
  readonly temporaryBits: number;
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
  return {
    remainder,
    quotient,
    shifts,
    compares,
    subtracts,
    tableOps,
    multiplies: 0,
    multiplyCycles: 0,
    temporaryBits: bitLength(remainder),
  };
}

/**
 * §10's reciprocal method: stop dividing and start multiplying.
 *
 * Newton–Raphson on `x → x(2 − Bx)` converges to `1/B`, doubling the number of
 * correct bits each iteration, and every operation in it is a multiplication —
 * which is the point. §10 lists this because the architecture already has
 * `MUL_WIDE`, so a divider that is mostly multiplies needs no new hardware; the
 * question is only whether it is cheaper, and that is what the metrics answer.
 *
 * The multiplies are charged by `mulWide`'s own cost model rather than by a
 * number invented here. A wide multiply is not a unit of work, and pricing it as
 * one would make the comparison say whatever the pricing said.
 *
 * The answer is exact. Newton gives an estimate; the corrections at the end make
 * it the quotient, and their count is reported rather than hidden — a poor
 * estimate shows up as work rather than as a wrong result.
 */
function reciprocalNewton(scaled: bigint, divisor: bigint, multiplyDigitBits: DigitWidth): Digits {
  // Nothing to estimate: the quotient is zero and the dividend is the remainder.
  // Also the guard that keeps the initial shift below from going negative.
  if (scaled < divisor) {
    return {
      remainder: scaled,
      quotient: 0n,
      shifts: 0,
      compares: 1,
      subtracts: 0,
      tableOps: 0,
      multiplies: 0,
      multiplyCycles: 0,
      temporaryBits: bitLength(scaled),
    };
  }

  const scale = bitLength(scaled) + 1;
  const divisorBits = bitLength(divisor);
  // Operands reach about `scale` bits and `mulWide` declares a destination of
  // twice its register, so this is the width the method actually needs.
  const registerBits = scale + 2;

  let multiplies = 0;
  let multiplyCycles = 0;
  let temporaryBits = 0;
  const times = (a: bigint, b: bigint): bigint => {
    const product = mulWide(a, b, { digitBits: multiplyDigitBits, registerBits });
    multiplies += 1;
    multiplyCycles += product.metrics.modeledCycles;
    temporaryBits = Math.max(temporaryBits, product.metrics.wideTemporaryBits);
    return product.value;
  };

  // `2^(scale − divisorBits)` is within a factor of two of `2^scale / B`, so the
  // iteration starts one bit correct and doubles from there.
  const shift = BigInt(scale);
  const twice = 1n << BigInt(scale + 1);
  let estimate = 1n << BigInt(scale - divisorBits);
  let compares = 0;

  // Truncating each step costs about a bit, so this cannot be run to a fixed
  // count derived from the ideal convergence; it runs until the estimate stops
  // moving, with a cap that cannot be reached by a converging sequence.
  const cap = 4 * Math.ceil(Math.log2(Math.max(scale, 2))) + 8;
  for (let iteration = 0; iteration < cap; iteration += 1) {
    const next = times(estimate, twice - times(divisor, estimate)) >> shift;
    compares += 1;
    if (next === estimate) break;
    estimate = next;
  }

  let quotient = times(scaled, estimate) >> shift;
  let remainder = scaled - times(quotient, divisor);

  // The estimate can only be low, and that is provable rather than hopeful:
  //
  //     1/B − x(2 − Bx) = B(1/B − x)² ≥ 0
  //
  // so a Newton step never lands above `1/B`, and truncating each step only
  // lowers it further. The quotient therefore never overshoots.
  //
  // This was a downward correction loop first, symmetrical with the one below.
  // Mutation testing killed every other branch here and left that one alive:
  // no test could reach it, because nothing can. A loop that never runs is a
  // claim about behaviour that was never checked, so it is an assertion now —
  // if the reasoning above is ever wrong, this says so instead of quietly
  // papering over it.
  if (remainder < 0n) {
    throw new WideError(
      `reciprocal estimate overshot: remainder ${remainder} is negative, which the Newton bound forbids`,
    );
  }
  // Bounded, and the bound is the point.
  //
  // A converged estimate leaves the quotient at most one short, so this runs
  // once or not at all — measured, never more. Written as an open `while` it
  // was a liability rather than a loop: with a bad estimate it does not cost
  // more cycles, it runs an astronomical number of times on values hundreds of
  // bits wide and simply never returns. Mutation testing found that twice, by
  // hanging, and a synchronous BigInt loop is not something a test timeout can
  // interrupt.
  //
  // So the failure mode is a diagnosable error rather than a stall. If the
  // estimate is ever this wrong, the reasoning above is what is wrong.
  const CORRECTION_LIMIT = 4;
  let corrections = 0;
  while (remainder >= divisor) {
    quotient += 1n;
    remainder -= divisor;
    compares += 1;
    corrections += 1;
    if (corrections > CORRECTION_LIMIT) {
      throw new WideError(
        `reciprocal estimate needed more than ${CORRECTION_LIMIT} corrections, so it had not converged`,
      );
    }
  }
  compares += 2;

  return {
    remainder,
    quotient,
    shifts: 0,
    compares,
    subtracts: 0,
    tableOps: 0,
    multiplies,
    multiplyCycles,
    temporaryBits,
  };
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
    multiplies: 0,
    multiplyCycles: 0,
    temporaryBits: bitLength(remainder < 0n ? -remainder : remainder),
  };
}

export function divRem(request: DivRemRequest): DivRemResult {
  const {
    dividend,
    divisor,
    fractionBits = 0,
    algorithm = 'restoring-radix-2',
    multiplyDigitBits = 64,
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
  const { remainder, quotient, shifts, compares, subtracts, tableOps, ...work } =
    algorithm === 'non-restoring-radix-2'
      ? nonRestoring(scaled, divisorMagnitude, bits, steps)
      : algorithm === 'reciprocal-newton'
        ? // No quotient digits are produced in order, so there is nothing for a
          // digit trace to record. §22's animation simply does not apply to this
          // method, and saying so is better than inventing frames for it.
          reciprocalNewton(scaled, divisorMagnitude, multiplyDigitBits)
        : restoringRadix(scaled, divisorMagnitude, bits, RADIX_BITS[algorithm], steps);

  const partial = {
    algorithm,
    quotientDigitsGenerated: bits,
    shiftOperations: shifts,
    compareOperations: compares,
    subtractOperations: subtracts,
    tableOperations: tableOps,
    multiplyOperations: work.multiplies,
    multiplyCycles: work.multiplyCycles,
    temporaryBits: work.temporaryBits,
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
    // A restoring continuation multiplies nothing, so whatever the leading
    // digits cost in multiplies is what they cost.
    multiplyOperations: state.metrics.multiplyOperations,
    multiplyCycles: state.metrics.multiplyCycles,
    temporaryBits: state.metrics.temporaryBits,
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
