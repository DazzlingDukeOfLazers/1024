/**
 * `NARROW source → destination + residue`.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §8 and §13. Everything in this track so far
 * has refused to lose information: digit decomposition is a shift and a mask,
 * and `MUL_WIDE` keeps the whole product. This is where loss happens, and the
 * design rule is that it happens *here* and nowhere else — deliberately, under a
 * named policy, with the bits that did not fit handed back rather than dropped.
 *
 *     Keep the bits until someone explicitly chooses to throw them away.
 *     Return the leftovers.
 *
 * ## One interpretation worth flagging
 *
 * §8 lists twelve policies in a single block:
 *
 *     EXACT_REQUIRED TRUNCATE ROUND_NEAREST ROUND_TIES_EVEN ROUND_UP ROUND_DOWN
 *     SATURATE WRAP TRAP_INEXACT FLAG_INEXACT KEEP_RESIDUE ACCUMULATE_RESIDUE
 *
 * They are not alternatives to each other. Rounding to nearest and saturating on
 * overflow are answers to different questions, and a flat enum would either
 * forbid sensible combinations or need a name for each of them. So they are
 * modelled here as four orthogonal choices — how to round, what to do when the
 * result does not fit, how to react to inexactness, and what becomes of the
 * residue — and every one of the twelve names maps onto a setting of one axis.
 * That is an interpretation of the document rather than something it states, and
 * it is recorded in TASKS as such.
 */

import { type DigitWidth, WideError, bitLength, toDigits } from './digits';

/** How the discarded bits decide the destination's last bit. */
export type RoundingRule =
  | 'truncate' // toward zero
  | 'floor' // toward negative infinity — §8 ROUND_DOWN
  | 'ceil' // toward positive infinity — §8 ROUND_UP
  | 'nearest' // ties away from zero — §8 ROUND_NEAREST
  | 'nearest-even'; // §8 ROUND_TIES_EVEN

/** What happens when the rounded value will not fit the destination. */
export type RangeRule = 'trap' | 'saturate' | 'wrap';

/** What happens when anything was lost at all. */
export type InexactRule =
  | 'allow' // §8 FLAG_INEXACT: reported, never thrown
  | 'trap'; // §8 EXACT_REQUIRED / TRAP_INEXACT

/** What becomes of the leftovers. */
export type ResidueRule =
  | 'keep' // returned, which happens either way
  | 'discard' // returned, and explicitly not carried forward
  | 'accumulate'; // added into a running total the caller threads through

export interface NarrowPolicy {
  readonly rounding?: RoundingRule;
  readonly range?: RangeRule;
  readonly inexact?: InexactRule;
  readonly residue?: ResidueRule;
}

export interface NarrowRequest {
  /** Raw integer of the source, at `sourceFractionBits` of fraction. */
  readonly value: bigint;
  readonly sourceFractionBits: number;
  readonly sourceWidthBits: number;
  readonly destinationFractionBits: number;
  readonly destinationWidthBits: number;
  readonly policy?: NarrowPolicy;
  /** Running residue for `accumulate`, in units of the *source* LSB. */
  readonly residueAccumulator?: bigint;
  /** Only used to report `digitsProcessed` (§13). */
  readonly digitBits?: DigitWidth;
}

export interface NarrowResult {
  /** Raw integer of the destination, at `destinationFractionBits`. */
  readonly value: bigint;
  /**
   * Signed difference between what was asked for and what is kept, in units of
   * the source LSB: `source = (value << shift) + residue`. Negative when the
   * rounding rule pushed the destination above the source, which is the same
   * algebra as §9's `A = Q × B + R` with a signed remainder.
   */
  readonly residue: bigint;
  /**
   * The literal low bits that fell off, always non-negative and independent of
   * the rounding rule. This is the band §8's picture labels RESIDUE / LOST BITS.
   */
  readonly lostBits: bigint;
  readonly exact: boolean;
  readonly inexact: boolean;
  readonly overflow: boolean;
  readonly sourceWidth: number;
  readonly destinationWidth: number;
  readonly significantBitsProcessed: number;
  readonly digitsProcessed?: number | undefined;
  readonly modeledCycles: number;
  /** Present when the policy is `accumulate`. */
  readonly residueAccumulator?: bigint | undefined;
}

const DEFAULT_POLICY: Required<NarrowPolicy> = {
  rounding: 'nearest-even',
  range: 'trap',
  inexact: 'allow',
  residue: 'keep',
};

function signedRange(widthBits: number): { min: bigint; max: bigint } {
  const limit = 1n << BigInt(widthBits - 1);
  return { min: -limit, max: limit - 1n };
}

/**
 * Round `value / 2^shift` to an integer under the given rule.
 *
 * Written on integers rather than by going through `Rational`, because the
 * point of this architecture is that narrowing is a shift and a decision about
 * the bits that fall off — expressing it as division would hide the thing being
 * modelled. `narrow.test.ts` checks it against the exact-rational rounding in
 * `core/rational`, which is the independent implementation.
 */
function roundShifted(value: bigint, shift: number, rule: RoundingRule): bigint {
  if (shift === 0) return value;
  const divisor = 1n << BigInt(shift);

  // Floor division and the non-negative remainder, which BigInt's `>>` and `&`
  // give directly for both signs.
  const floor = value >> BigInt(shift);
  const remainder = value - (floor << BigInt(shift));
  if (remainder === 0n) return floor;

  switch (rule) {
    case 'floor':
      return floor;
    case 'ceil':
      return floor + 1n;
    case 'truncate':
      return value < 0n ? floor + 1n : floor;
    case 'nearest':
    case 'nearest-even': {
      const twice = remainder * 2n;
      if (twice > divisor) return floor + 1n;
      if (twice < divisor) return floor;
      // A tie. `nearest` goes away from zero; `nearest-even` picks the even
      // neighbour, which is the only rule of the five that looks at the value
      // it is about to produce rather than only at what it is discarding.
      if (rule === 'nearest') return value < 0n ? floor : floor + 1n;
      return (floor & 1n) === 0n ? floor : floor + 1n;
    }
  }
}

const CYCLES = {
  shift: 1,
  roundDecision: 1,
  rangeCheck: 1,
} as const;

export function narrow(request: NarrowRequest): NarrowResult {
  const {
    value,
    sourceFractionBits,
    sourceWidthBits,
    destinationFractionBits,
    destinationWidthBits,
    residueAccumulator,
    digitBits,
  } = request;
  const policy = { ...DEFAULT_POLICY, ...request.policy };

  const shift = sourceFractionBits - destinationFractionBits;
  if (shift < 0) {
    throw new WideError(
      `narrowing cannot add fraction bits: ${sourceFractionBits} → ${destinationFractionBits}`,
    );
  }

  const rounded = roundShifted(value, shift, policy.rounding);
  const residue = value - (rounded << BigInt(shift));
  const lostBits = shift === 0 ? 0n : value & ((1n << BigInt(shift)) - 1n);
  const inexact = residue !== 0n;

  if (inexact && policy.inexact === 'trap') {
    throw new WideError(`narrowing lost ${lostBits} and the policy requires an exact result`);
  }

  const { min, max } = signedRange(destinationWidthBits);
  const overflow = rounded < min || rounded > max;
  let stored = rounded;
  if (overflow) {
    switch (policy.range) {
      case 'trap':
        throw new WideError(
          `narrowed value ${rounded} does not fit ${destinationWidthBits} signed bits`,
        );
      case 'saturate':
        stored = rounded < min ? min : max;
        break;
      case 'wrap': {
        const span = 1n << BigInt(destinationWidthBits);
        stored = ((((rounded - min) % span) + span) % span) + min;
        break;
      }
    }
  }

  const modeledCycles = CYCLES.shift + (shift === 0 ? 0 : CYCLES.roundDecision) + CYCLES.rangeCheck;

  return {
    value: stored,
    residue,
    lostBits,
    exact: !inexact,
    inexact,
    overflow,
    sourceWidth: sourceWidthBits,
    destinationWidth: destinationWidthBits,
    significantBitsProcessed: bitLength(value < 0n ? -value : value),
    ...(digitBits === undefined
      ? {}
      : { digitsProcessed: toDigits(value < 0n ? -value : value, digitBits).length }),
    modeledCycles,
    ...(policy.residue === 'accumulate'
      ? { residueAccumulator: (residueAccumulator ?? 0n) + residue }
      : {}),
  };
}
