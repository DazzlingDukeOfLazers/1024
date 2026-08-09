/**
 * Running one workload under several machine contracts.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §14 and §21. The document's point is not
 * that any one policy is right, it is that the same arithmetic under different
 * policies produces measurably different answers and measurably different work,
 * and that the simulator should replace intuition with those measurements.
 *
 * Every run carries an exact rational reference alongside the simulated value,
 * computed with the project's existing exact core. That is what makes
 * divergence a fact rather than a comparison between two guesses — and it is the
 * same discipline `ExactReference` already imposes on the older machines
 * (CLAUDE.md rule 1).
 *
 * The residue is tracked as an exact rational too, not as a raw integer, because
 * residues from a multiply and from a division live at different scales and
 * adding them as integers would be quietly wrong.
 */

import {
  type Rational,
  ZERO,
  add,
  div as divExact,
  isZero,
  mul as mulExact,
  pow2,
  rational,
  sub,
} from '../rational/rational';
import { type Scenario } from './scenario';
import { mulWide } from './multiply';
import { narrow } from './narrow';
import { divRem, refine } from './divide';

export type WorkloadOp =
  | { readonly op: 'add'; readonly operand: bigint }
  | { readonly op: 'sub'; readonly operand: bigint }
  | { readonly op: 'mul'; readonly operand: bigint }
  | { readonly op: 'div'; readonly operand: bigint };

export interface Workload {
  readonly id: string;
  readonly label: string;
  /** Starting value, as an exact rational. */
  readonly initial: Rational;
  readonly steps: readonly WorkloadOp[];
}

export interface WorkloadRun {
  readonly scenario: string;
  readonly workload: string;
  /** Raw fixed-point register at the scenario's working fraction width. */
  readonly raw: bigint;
  /** What that register means. */
  readonly value: Rational;
  /** What the arithmetic actually was, exactly. */
  readonly exact: Rational;
  /** `value − exact`. Zero when nothing was lost, or when it was all carried. */
  readonly divergence: Rational;
  /** Everything narrowing took away, as an exact rational. */
  readonly carriedResidue: Rational;
  readonly inexactSteps: number;
  readonly totals: {
    readonly partialProductsExecuted: number;
    readonly partialProductsSkipped: number;
    readonly quotientDigitsGenerated: number;
    readonly modeledCycles: number;
  };
}

/**
 * §5. Same-scale addition and subtraction are exact if the result fits, with no
 * exponent alignment and no magnitude-dependent resolution change — so these
 * steps never narrow and never lose anything.
 */
function scaleOf(scenario: Scenario): Rational {
  return pow2(-scenario.architecture.fractionBits);
}

export function runWorkload(workload: Workload, scenario: Scenario): WorkloadRun {
  const fractionBits = scenario.architecture.fractionBits;
  const unit = 1n << BigInt(fractionBits);

  // The register, and the exact truth it is trying to be.
  let raw = toRaw(workload.initial, fractionBits);
  let exact = mulExact(rational(raw), scaleOf(scenario));
  let carriedResidue = ZERO;
  let inexactSteps = 0;

  const totals = {
    partialProductsExecuted: 0,
    partialProductsSkipped: 0,
    quotientDigitsGenerated: 0,
    modeledCycles: 0,
  };

  for (const step of workload.steps) {
    switch (step.op) {
      case 'add':
      case 'sub': {
        // Exact by construction at a common scale (§5).
        const operandRaw = step.operand * unit;
        raw = step.op === 'add' ? raw + operandRaw : raw - operandRaw;
        exact =
          step.op === 'add'
            ? add(exact, rational(step.operand))
            : sub(exact, rational(step.operand));
        break;
      }

      case 'mul': {
        // Wide first (§7): the product of a Q.f value and an integer is still
        // Q.f, but going through MUL_WIDE is what the architecture asks for and
        // is what gets counted.
        const product = mulWide(raw, step.operand, {
          digitBits: scenario.architecture.digitBits,
          registerBits: scenario.architecture.registerBits,
          skipZeroDigits: scenario.optimization.skipZeroDigits,
        });
        totals.partialProductsExecuted += product.metrics.partialProductsExecuted;
        totals.partialProductsSkipped += product.metrics.partialProductsSkipped;
        raw = product.value;
        exact = mulExact(exact, rational(step.operand));
        // Residue already carried is scaled by this operation too. A bit lost
        // three steps ago and then multiplied by three is three bits' worth of
        // divergence now — the same inherited propagation `docs/NUMERICS.md` §7
        // separates from the error an operation introduces itself.
        carriedResidue = mulExact(carriedResidue, rational(step.operand));
        break;
      }

      case 'div': {
        // §11 and §12: divide at the working precision, then chase the quotient
        // to the scenario's budget if it has not terminated.
        let quotient = divRem({
          dividend: raw,
          divisor: step.operand,
          fractionBits: 0,
        });
        if (!quotient.exact && scenario.division.maxFractionBits > 0) {
          quotient = refine(quotient, Math.min(64, scenario.division.maxFractionBits));
        }
        totals.quotientDigitsGenerated += quotient.metrics.quotientDigitsGenerated;
        totals.modeledCycles += quotient.metrics.modeledCycles;

        // The quotient came back with extra fraction bits; narrowing brings it
        // home, under the scenario's policy, and hands back what it dropped.
        const narrowed = narrow({
          value: quotient.quotient,
          sourceFractionBits: fractionBits + quotient.fractionBits,
          sourceWidthBits: scenario.architecture.registerBits * 2,
          destinationFractionBits: fractionBits,
          destinationWidthBits: scenario.architecture.registerBits,
          policy: scenario.narrowing,
        });
        if (narrowed.inexact) inexactSteps += 1;

        // Two separate losses at this step, both taken from what the machine
        // reported rather than derived from the exact reference — deriving them
        // from the answer would make the conservation check circular.
        //
        // The division kept `quotient.remainder` back, which is worth
        // `remainder / (divisor × 2^F)` in the result's own terms; the narrowing
        // then dropped `narrowed.residue`, worth `residue × 2^-F`. Residue
        // already carried propagates through the division as well.
        const quotientScale = pow2(-(fractionBits + quotient.fractionBits));
        const divisionLoss = mulExact(
          divExact(rational(quotient.remainder), rational(step.operand)),
          quotientScale,
        );
        const narrowingLoss = mulExact(rational(narrowed.residue), quotientScale);

        // Only a machine that carries the residue has one. Under `discard` the
        // information is gone, and a runner that tallied it anyway would be
        // reporting a conservation the machine did not perform.
        carriedResidue = divExact(carriedResidue, rational(step.operand));
        if (scenario.narrowing.residue === 'accumulate') {
          carriedResidue = add(carriedResidue, add(divisionLoss, narrowingLoss));
        }

        raw = narrowed.value;
        exact = divExact(exact, rational(step.operand));
        break;
      }
    }
  }

  const value = mulExact(rational(raw), scaleOf(scenario));
  return {
    scenario: scenario.id,
    workload: workload.id,
    raw,
    value,
    exact,
    divergence: sub(value, exact),
    carriedResidue,
    inexactSteps,
    totals,
  };
}

/** Exact rational → raw register, truncating toward zero. */
function toRaw(value: Rational, fractionBits: number): bigint {
  const scaled = mulExact(value, pow2(fractionBits));
  if (!isZero(sub(scaled, rational(scaled.numerator / scaled.denominator)))) {
    // The workloads here all start on representable values; anything else would
    // need a narrowing policy before the run began, which would confuse the
    // comparison the run exists to make.
    throw new Error('workload must start on a value the working format can hold exactly');
  }
  return scaled.numerator / scaled.denominator;
}

/**
 * §21's "cancellation-heavy arithmetic", in the smallest form that shows the
 * point: divide by something that does not terminate in binary, then multiply
 * back. Exact arithmetic returns to where it started; a machine that discards
 * what did not fit does not.
 */
export const DIVIDE_AND_RESTORE: Workload = {
  id: 'divide-and-restore',
  label: 'Divide by seven and multiply back, ten times',
  initial: rational(1n),
  steps: Array.from({ length: 10 }, (_, index) =>
    index % 2 === 0 ? ({ op: 'div', operand: 7n } as const) : ({ op: 'mul', operand: 7n } as const),
  ),
};

/**
 * The same shape with three instead of seven, kept because it behaves
 * differently in a way worth knowing.
 *
 * One third is `0.010101…` in binary, so the bits a narrowing drops here are
 * always about a third of the way to the next representable value and never
 * past halfway. Rounding to nearest therefore rounds down every time and gives
 * bit-for-bit the same answer as truncation. Seven's expansion visits remainders
 * on both sides of half, so under seven the two policies part company.
 *
 * That is a fact about the divisor rather than about the machine. A comparison
 * of rounding policies run on thirds would measure nothing and look like it had
 * measured something, which is the shape of mistake this repository keeps
 * finding — so it is a test rather than a footnote.
 */
export const THIRDS_AND_BACK: Workload = {
  id: 'thirds-and-back',
  label: 'Divide by three and multiply back, ten times',
  initial: rational(1n),
  steps: Array.from({ length: 10 }, (_, index) =>
    index % 2 === 0 ? ({ op: 'div', operand: 3n } as const) : ({ op: 'mul', operand: 3n } as const),
  ),
};

/** §21's "coordinate accumulation": many small exact additions, then a scaling. */
export const ACCUMULATE_THEN_SCALE: Workload = {
  id: 'accumulate-then-scale',
  label: 'Add one a thousand times, then divide by seven',
  initial: ZERO,
  steps: [
    ...Array.from({ length: 1000 }, () => ({ op: 'add', operand: 1n }) as const),
    { op: 'div', operand: 7n } as const,
  ],
};

export const WORKLOADS = [DIVIDE_AND_RESTORE, THIRDS_AND_BACK, ACCUMULATE_THEN_SCALE] as const;
