/**
 * The same arithmetic in several representations at once.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §21 and §23, and the research question in
 * §24: if a floating-point numerical contract is traded for very wide fixed
 * point, what is gained and what is paid?
 *
 * This is where the architecture track meets the machines the project already
 * had. binary64, Q128.128 and the exact rational reference were built in the
 * original milestones; the wide digit-serial fixed point is new. Running one
 * workload through all of them is the comparison §21 asks for, and it is the
 * only way §24's question gets an answer rather than an opinion.
 *
 * Each representation holds its own value and each step is computed **from that
 * stored value**, exactly, and then quantized once. That is what IEEE 754
 * specifies for a single operation and what `docs/NUMERICS.md` §7 already
 * requires of the older machines: the error a step introduces is separate from
 * the error it inherits, and modelling it any other way would blur the two.
 *
 * §23 is the statement being tested, and it is careful:
 *
 *   > This architecture does not eliminate every finite-representation error.
 *   > It changes where error occurs.
 *
 * So the interesting output is not "which is smallest" but how the error behaves
 * as the numbers move.
 */

import {
  type Rational,
  ZERO,
  abs,
  add,
  div,
  gt,
  isZero,
  mul,
  rational,
  sub,
} from '../rational/rational';
import { encodeRational, isFiniteState } from '../representations/binary64';
import {
  type Q128_128Config,
  DEFAULT_Q128_128_CONFIG,
  encodeMeters as encodeQ128,
} from '../representations/q128_128';
import { narrow } from './narrow';
import type { NarrowPolicy } from './narrow';

export const REPRESENTATIONS = ['exact', 'binary64', 'q128.128', 'wide-fixed-point'] as const;
export type Representation = (typeof REPRESENTATIONS)[number];

export type ComparisonOp = 'add' | 'sub' | 'mul' | 'div';

export interface ComparisonStep {
  readonly op: ComparisonOp;
  readonly operand: Rational;
}

export interface ComparisonWorkload {
  readonly id: string;
  readonly label: string;
  /** What §21 calls the workload shape, in one line. */
  readonly intent: string;
  readonly initial: Rational;
  readonly steps: readonly ComparisonStep[];
}

export interface RepresentationRun {
  readonly representation: Representation;
  /** Value held at the end, or `undefined` if the machine could not hold it. */
  readonly final?: Rational | undefined;
  /** `final − exact`. */
  readonly divergence?: Rational | undefined;
  /** |divergence| ÷ |exact|, where the exact result is non-zero. */
  readonly relativeError?: Rational | undefined;
  /** Largest single-step quantization this representation introduced. */
  readonly worstStepError: Rational;
  /** How many steps introduced any error at all. */
  readonly inexactSteps: number;
  readonly note?: string | undefined;
}

export interface ComparisonOptions {
  readonly q128?: Q128_128Config;
  /** Fraction bits of the wide fixed-point machine. */
  readonly wideFractionBits?: number;
  readonly wideRegisterBits?: number;
  readonly narrowing?: NarrowPolicy;
}

function applyExact(value: Rational, step: ComparisonStep): Rational {
  switch (step.op) {
    case 'add':
      return add(value, step.operand);
    case 'sub':
      return sub(value, step.operand);
    case 'mul':
      return mul(value, step.operand);
    case 'div':
      return div(value, step.operand);
  }
}

/**
 * Quantize onto one representation's grid. Returns `undefined` when the machine
 * cannot hold the value at all, which is a different outcome from holding it
 * badly and must not be reported as a large error.
 */
function quantize(
  representation: Representation,
  wanted: Rational,
  options: Required<Pick<ComparisonOptions, 'q128' | 'wideFractionBits' | 'wideRegisterBits'>> & {
    narrowing: NarrowPolicy;
  },
): Rational | undefined {
  switch (representation) {
    case 'exact':
      return wanted;

    case 'binary64': {
      const encoded = encodeRational(wanted);
      return isFiniteState(encoded.state) ? encoded.state.exact : undefined;
    }

    case 'q128.128': {
      const write = encodeQ128(options.q128, wanted);
      return write.decodedMeters;
    }

    case 'wide-fixed-point': {
      // The wide machine's grid is `2^-fractionBits`, so quantizing is a
      // narrowing from the exact value onto that lattice — the same operation
      // the architecture uses everywhere else, with the same policy.
      const scale = 1n << BigInt(options.wideFractionBits);
      const scaled = mul(wanted, rational(scale));
      // `narrow` works on integers, so the exact rational is first expressed on
      // a much finer grid and then brought down. 64 extra bits is far more than
      // the destination needs and keeps the intermediate exact for the values
      // these workloads produce.
      const fine = 64;
      const raw = (scaled.numerator * (1n << BigInt(fine))) / scaled.denominator;
      const result = narrow({
        value: raw,
        sourceFractionBits: fine,
        sourceWidthBits: options.wideRegisterBits * 2,
        destinationFractionBits: 0,
        destinationWidthBits: options.wideRegisterBits,
        policy: { ...options.narrowing, range: 'trap' },
      });
      return div(rational(result.value), rational(scale));
    }
  }
}

export function compareRepresentations(
  workload: ComparisonWorkload,
  options: ComparisonOptions = {},
): RepresentationRun[] {
  const settings = {
    q128: options.q128 ?? DEFAULT_Q128_128_CONFIG,
    wideFractionBits: options.wideFractionBits ?? 128,
    wideRegisterBits: options.wideRegisterBits ?? 1024,
    narrowing: options.narrowing ?? { rounding: 'nearest-even' as const },
  };

  // The truth every other arm is measured against.
  let exact = workload.initial;
  for (const step of workload.steps) exact = applyExact(exact, step);

  return REPRESENTATIONS.map((representation) => {
    let value: Rational | undefined = quantize(representation, workload.initial, settings);
    let worstStepError = ZERO;
    let inexactSteps = 0;
    let note: string | undefined;

    for (const step of workload.steps) {
      if (value === undefined) break;
      // Exactly from where this machine actually is, then quantized once.
      const wanted = applyExact(value, step);
      const next = quantize(representation, wanted, settings);
      if (next === undefined) {
        value = undefined;
        note = 'out of range for this machine';
        break;
      }
      const introduced = abs(sub(next, wanted));
      if (!isZero(introduced)) {
        inexactSteps += 1;
        if (gt(introduced, worstStepError)) worstStepError = introduced;
      }
      value = next;
    }

    if (value === undefined) {
      return { representation, worstStepError, inexactSteps, note };
    }

    const divergence = sub(value, exact);
    return {
      representation,
      final: value,
      divergence,
      ...(isZero(exact) ? {} : { relativeError: abs(div(divergence, exact)) }),
      worstStepError,
      inexactSteps,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* §21's workloads, in the smallest forms that separate the representations     */
/* -------------------------------------------------------------------------- */

const ONE_TENTH = rational(1n, 10n);

/**
 * §21 "coordinate accumulation". A thousand additions of a value no binary
 * format holds exactly.
 *
 * The point is not that everything drifts — everything does — but *how*. Fixed
 * point has one absolute quantum, so its per-step error is the same at the end
 * as at the start. binary64's spacing widens with magnitude, so its per-step
 * error grows as the sum does.
 */
export const ACCUMULATE_TENTHS: ComparisonWorkload = {
  id: 'accumulate-tenths',
  label: 'Add 0.1 a thousand times',
  intent: 'Coordinate accumulation, at a magnitude that stays small.',
  initial: ZERO,
  steps: Array.from({ length: 1000 }, () => ({ op: 'add', operand: ONE_TENTH }) as const),
};

/**
 * The same accumulation, starting a million metres from the origin.
 *
 * §23's distinction made visible: the fixed-point machines behave identically to
 * the run above, because their resolution does not depend on where they are.
 * binary64's does.
 */
export const ACCUMULATE_TENTHS_FAR: ComparisonWorkload = {
  id: 'accumulate-tenths-far',
  label: 'Add 0.1 a thousand times, starting at 10^6',
  intent: 'The same coordinate accumulation, a long way from zero.',
  initial: rational(1000000n),
  steps: Array.from({ length: 1000 }, () => ({ op: 'add', operand: ONE_TENTH }) as const),
};

/** §21 "cancellation-heavy arithmetic". */
export const CANCELLATION: ComparisonWorkload = {
  id: 'cancellation',
  label: 'Add 10^8, add 1, subtract 10^8',
  intent: 'Cancellation: a small quantity beside a large one.',
  initial: ZERO,
  steps: [
    { op: 'add', operand: rational(100000000n) },
    { op: 'add', operand: rational(1n) },
    { op: 'sub', operand: rational(100000000n) },
  ],
};

export const COMPARISON_WORKLOADS = [
  ACCUMULATE_TENTHS,
  ACCUMULATE_TENTHS_FAR,
  CANCELLATION,
] as const;
