/**
 * `MUL_WIDE` — digit-serial multiplication that keeps every bit.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §6 and §7. The contract is deliberately not
 * `1024 × 1024 → silently rounded 1024`. It is `1024 × 1024 → 2048`, because
 * the product of two values genuinely needs that width, and a machine that
 * throws half of it away in the same instruction has merged two decisions —
 * calculating, and choosing what to lose — that this architecture exists to
 * separate. Narrowing is a later, explicit operation with a policy and a
 * residue.
 *
 * The accumulation really is done digit by digit rather than by asking the
 * language for `a * b` and reporting invented metrics. That matters: the whole
 * point is to count the work, and a count that does not come from the work it
 * describes is decoration. `a * b` appears in the tests, as the oracle it is
 * checked against (§19), and nowhere in the implementation.
 *
 * Reintegration is exact (§6). Every partial product lands at a known power-of-
 * two position, so recombination is integer addition and nothing rounds. The
 * hard parts here are scheduling and carries, not precision.
 */

import { type DigitWidth, WideError, bitLength, profile, toDigits } from './digits';

/**
 * What the machine is allowed to do, and what it is charged for.
 *
 * §4 is explicit that skipping zero digits must not be assumed free, so the
 * control cost of inspecting a digit is a parameter rather than a constant. Set
 * `cyclesPerDigitInspection` high enough and sparsity stops paying — which is
 * the experiment, not a flaw in it.
 */
export interface WideMultiplyOptions {
  readonly digitBits: DigitWidth;
  /** Declared architectural width of each operand. */
  readonly registerBits: number;
  /** §14 `optimization.skipZeroDigits`. */
  readonly skipZeroDigits?: boolean;
  /** Modeled cost of one `digit × digit → 2·digit` primitive multiply. */
  readonly cyclesPerPartialProduct?: number;
  /** Modeled cost of looking at a digit to decide whether to skip it. */
  readonly cyclesPerDigitInspection?: number;
  /** Modeled cost of accumulating one partial product into the wide sum. */
  readonly cyclesPerAccumulate?: number;
}

/** §20. Numerical behaviour and computational work, measured separately. */
export interface WideMetrics {
  readonly architecturalWidth: number;
  readonly destinationWidth: number;
  /** Bits actually occupied by the operands, which may be far fewer (§3). */
  readonly significantWidthA: number;
  readonly significantWidthB: number;
  readonly digitBits: DigitWidth;
  readonly digitsInspected: number;
  readonly nonzeroDigitsA: number;
  readonly nonzeroDigitsB: number;
  readonly partialProductsPossible: number;
  readonly partialProductsExecuted: number;
  readonly partialProductsSkipped: number;
  /** Accumulator additions performed, one per executed partial product. */
  readonly accumulateOperations: number;
  /** Widest intermediate the accumulator had to hold. */
  readonly wideTemporaryBits: number;
  readonly modeledCycles: number;
}

/** §13. A result carries what it did as well as what it produced. */
export interface WideMultiplyResult {
  readonly value: bigint;
  /**
   * Always true. `MUL_WIDE` cannot be inexact — that is the point of §7, and
   * the field exists so a caller reading a result object never has to know
   * which operations round and which do not.
   */
  readonly exact: true;
  readonly metrics: WideMetrics;
}

const DEFAULTS = {
  skipZeroDigits: true,
  cyclesPerPartialProduct: 1,
  cyclesPerDigitInspection: 1,
  cyclesPerAccumulate: 1,
} as const;

/**
 * Multiply two signed values, keeping the full product.
 *
 * Sign is handled at the boundary and the digits are magnitudes, per §6, whose
 * decomposition `A = Σ ai × 2^(Ni)` is stated for magnitudes. A two's-complement
 * digit array whose top digit quietly means something different would be a worse
 * lie than an explicit sign.
 */
export function mulWide(a: bigint, b: bigint, options: WideMultiplyOptions): WideMultiplyResult {
  const {
    digitBits,
    registerBits,
    skipZeroDigits = DEFAULTS.skipZeroDigits,
    cyclesPerPartialProduct = DEFAULTS.cyclesPerPartialProduct,
    cyclesPerDigitInspection = DEFAULTS.cyclesPerDigitInspection,
    cyclesPerAccumulate = DEFAULTS.cyclesPerAccumulate,
  } = options;

  const negative = a < 0n !== b < 0n;
  const magnitudeA = a < 0n ? -a : a;
  const magnitudeB = b < 0n ? -b : b;

  const profileA = profile(magnitudeA, digitBits, registerBits);
  const profileB = profile(magnitudeB, digitBits, registerBits);
  const digitsA = toDigits(magnitudeA, digitBits, registerBits);
  const digitsB = toDigits(magnitudeB, digitBits, registerBits);

  let accumulator = 0n;
  let executed = 0;
  let inspected = 0;
  let wideTemporaryBits = 0;

  // §6: A × B = ΣΣ (ai × bj) × 2^(N(i+j)). Each partial product has an exact
  // destination bit position, so the accumulator only ever adds.
  // An inspection is the cost of *deciding* whether to skip, so it is only
  // incurred when there is a decision. Charging it with `skipZeroDigits` off had
  // the model billing the machine for a choice it was not making, which made
  // skipping look unconditionally cheaper — the opposite of the trade §4 asks to
  // be measured. The test that asserts skipping can lose is what caught it.
  for (let i = 0; i < digitsA.length; i += 1) {
    const digitA = digitsA[i]!;
    if (skipZeroDigits) {
      inspected += 1;
      if (digitA === 0n) continue;
    }

    for (let j = 0; j < digitsB.length; j += 1) {
      const digitB = digitsB[j]!;
      if (skipZeroDigits) {
        inspected += 1;
        if (digitB === 0n) continue;
      }

      const product = digitA * digitB;
      accumulator += product << BigInt(digitBits * (i + j));
      executed += 1;
      wideTemporaryBits = Math.max(wideTemporaryBits, bitLength(accumulator));
    }
  }

  const destinationWidth = registerBits * 2;
  if (bitLength(accumulator) > destinationWidth) {
    // Cannot happen for in-range operands, and is worth saying rather than
    // assuming: two n-bit magnitudes multiply to at most 2n bits.
    throw new WideError(
      `product needs ${bitLength(accumulator)} bits, destination declares ${destinationWidth}`,
    );
  }

  const possible = digitsA.length * digitsB.length;
  const modeledCycles =
    inspected * cyclesPerDigitInspection +
    executed * (cyclesPerPartialProduct + cyclesPerAccumulate);

  return {
    value: negative ? -accumulator : accumulator,
    exact: true,
    metrics: {
      architecturalWidth: registerBits,
      destinationWidth,
      significantWidthA: profileA.significantBits,
      significantWidthB: profileB.significantBits,
      digitBits,
      digitsInspected: inspected,
      nonzeroDigitsA: profileA.nonzeroDigits,
      nonzeroDigitsB: profileB.nonzeroDigits,
      partialProductsPossible: possible,
      partialProductsExecuted: executed,
      partialProductsSkipped: possible - executed,
      accumulateOperations: executed,
      wideTemporaryBits,
      modeledCycles,
    },
  };
}
