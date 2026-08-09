/**
 * Per-representation error ledger.
 *
 * docs/NUMERICS.md §6 and §7. Every simulated representation owns one of these.
 * There is deliberately no global error bucket: signed errors cancel, and
 * operand-encoding error is a different thing from operation rounding error.
 *
 * The exact cumulative totals are diagnostics. They are **not** expected to
 * equal the current divergence, because earlier errors can be cancelled or
 * amplified by later operations. The Q512.512 meters sit alongside the exact
 * totals so the finite meter's own quantization stays observable.
 */

import { type Rational, ZERO, abs, add, sub } from '../rational/rational';
import { type FixedPointState } from './fixedPoint';
import { type OverflowEvent } from './integers';
import { accumulate, accumulateAbsolute, createAccumulator } from './q512_512';

/**
 * One step's error decomposition, in the **output quantity's unit**.
 *
 * docs/NUMERICS.md §7:
 *
 *     current divergence
 *       = inherited/propagated divergence
 *       + operand-encoding contribution
 *       + operation rounding/quantization error
 */
export interface ErrorContribution {
  /** `R_new - E_new`. */
  signedDivergence: Rational;
  /** `exact(op(R_prev, O)) - E_new`. Divergence carried in from earlier steps. */
  inheritedPropagation: Rational;
  /** `exact(op(R_prev, O_r)) - exact(op(R_prev, O))`. */
  operandEncodingContribution: Rational;
  /** `R_new - exact(op(R_prev, O_r))`. */
  operationRoundingError: Rational;
  /**
   * `O_r - O`, for inspection only. For multiplication and division this may
   * not even share the result's dimension, so it never feeds the meters
   * (docs/NUMERICS.md §7).
   */
  rawOperandEncodingDelta?: Rational;
}

export interface ErrorLedger {
  currentSignedDivergence: Rational;
  currentAbsoluteDivergence: Rational;
  currentSignedInheritedPropagation: Rational;

  exactRawOperandEncodingDelta?: Rational;
  exactSignedOperandEncodingContribution: Rational;
  exactAbsoluteOperandEncodingContribution: Rational;

  exactSignedOperationRoundingError: Rational;
  exactAbsoluteOperationRoundingError: Rational;

  cumulativeAbsoluteOperandEncodingContribution: Rational;
  cumulativeAbsoluteOperationRoundingError: Rational;
  /**
   * Exact counterpart of the signed Q512.512 meter. Kept so the finite meter's
   * own quantization and saturation can be measured against exact truth.
   */
  cumulativeSignedIntroducedError: Rational;

  q512_512SignedAccumulator: FixedPointState;
  q512_512AbsoluteAccumulator: FixedPointState;

  /** Overflow/saturation events raised by the meters themselves. */
  meterEvents: readonly OverflowEvent[];
  /** Number of contributions recorded. */
  steps: number;
}

export function createErrorLedger(): ErrorLedger {
  return {
    currentSignedDivergence: ZERO,
    currentAbsoluteDivergence: ZERO,
    currentSignedInheritedPropagation: ZERO,

    exactSignedOperandEncodingContribution: ZERO,
    exactAbsoluteOperandEncodingContribution: ZERO,

    exactSignedOperationRoundingError: ZERO,
    exactAbsoluteOperationRoundingError: ZERO,

    cumulativeAbsoluteOperandEncodingContribution: ZERO,
    cumulativeAbsoluteOperationRoundingError: ZERO,
    cumulativeSignedIntroducedError: ZERO,

    q512_512SignedAccumulator: createAccumulator(),
    q512_512AbsoluteAccumulator: createAccumulator(),

    meterEvents: [],
    steps: 0,
  };
}

/**
 * Record one step. Returns a new ledger; ledgers are immutable like experiment
 * steps.
 *
 * Only the newly *introduced* error feeds the finite meters — inherited
 * divergence is already in there from the step that created it.
 */
export function recordContribution(
  ledger: ErrorLedger,
  contribution: ErrorContribution,
): ErrorLedger {
  const introduced = add(
    contribution.operandEncodingContribution,
    contribution.operationRoundingError,
  );

  const signed = accumulate(ledger.q512_512SignedAccumulator, introduced);
  const absolute = accumulateAbsolute(ledger.q512_512AbsoluteAccumulator, introduced);
  const events = [
    ...ledger.meterEvents,
    ...(signed.overflow ? [signed.overflow] : []),
    ...(absolute.overflow ? [absolute.overflow] : []),
  ];

  const next: ErrorLedger = {
    currentSignedDivergence: contribution.signedDivergence,
    currentAbsoluteDivergence: abs(contribution.signedDivergence),
    currentSignedInheritedPropagation: contribution.inheritedPropagation,

    exactSignedOperandEncodingContribution: contribution.operandEncodingContribution,
    exactAbsoluteOperandEncodingContribution: abs(contribution.operandEncodingContribution),

    exactSignedOperationRoundingError: contribution.operationRoundingError,
    exactAbsoluteOperationRoundingError: abs(contribution.operationRoundingError),

    cumulativeAbsoluteOperandEncodingContribution: add(
      ledger.cumulativeAbsoluteOperandEncodingContribution,
      abs(contribution.operandEncodingContribution),
    ),
    cumulativeAbsoluteOperationRoundingError: add(
      ledger.cumulativeAbsoluteOperationRoundingError,
      abs(contribution.operationRoundingError),
    ),
    cumulativeSignedIntroducedError: add(ledger.cumulativeSignedIntroducedError, introduced),

    q512_512SignedAccumulator: signed.state,
    q512_512AbsoluteAccumulator: absolute.state,

    meterEvents: events,
    steps: ledger.steps + 1,
  };

  return contribution.rawOperandEncodingDelta === undefined
    ? next
    : { ...next, exactRawOperandEncodingDelta: contribution.rawOperandEncodingDelta };
}

/**
 * Check the §7 identity for one contribution. The runner asserts this so a
 * decomposition bug cannot hide behind plausible-looking numbers.
 */
export function decompositionResidual(contribution: ErrorContribution): Rational {
  const parts = add(
    add(contribution.inheritedPropagation, contribution.operandEncodingContribution),
    contribution.operationRoundingError,
  );
  return sub(contribution.signedDivergence, parts);
}
