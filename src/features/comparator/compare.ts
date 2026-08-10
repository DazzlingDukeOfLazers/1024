/**
 * Comparison operations.
 *
 * docs/DATA_MODEL.md: operations belong to dimensions, and `123 coconuts` is
 * incomplete until one is chosen — a count has no intrinsic length. Every
 * operation here therefore takes quantities, never bare objects.
 *
 * The result separates two things the UI must never merge: the arithmetic is
 * always exact, and the *inputs* may not be. `1 mm / 1 µm` is exactly 1000;
 * `1 mm / one red blood cell` is about 133, and the "about" is a property of the
 * cell, not of the division.
 */

import {
  type Rational,
  abs,
  div,
  isZero,
  mul,
  sub as subRational,
} from '../../core/rational/rational';
import {
  type Quantity,
  ratio as quantityRatio,
  scale,
  sub as subQuantity,
} from '../../core/quantities/quantity';
import { type DimensionKind } from '../../core/units/dimensions';
import {
  type ApproximationKind,
  type CatalogQuantity,
  type ScaleObject,
} from '../../catalog/schema';
import { requireLength } from '../../catalog/catalog';
import { toExactDecimalString } from '../../core/rational/decimal';
import { DENSEST_SPHERE_PACKING_TEXT, RANDOM_CLOSE_PACKING } from './packing';

export const COMPARISON_OPERATIONS = [
  'ratio',
  'how-many-fit',
  'end-to-end',
  'difference',
  'area-ratio',
  'volume-ratio',
  'how-many-fit-volume',
] as const;
export type ComparisonOperation = (typeof COMPARISON_OPERATIONS)[number];

export class ComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonError';
  }
}

/**
 * One side of a comparison: a quantity plus everything needed to say how well
 * it is known.
 */
export interface Subject {
  readonly label: string;
  readonly dimension: DimensionKind;
  readonly value: Quantity;
  readonly range?: { readonly min: Quantity; readonly max: Quantity };
  readonly approximation: ApproximationKind;
  readonly source?: string;
  readonly note?: string;
}

/**
 * A user's pick for one side of a comparison: a catalog object, or an exactly
 * defined unit literal. Serializable, because share state has to carry it.
 */
export type SubjectChoice = { kind: 'object'; id: string } | { kind: 'unit'; symbol: string };

export function subjectFromCatalog(object: ScaleObject, quantityKey?: string): Subject {
  let entry: CatalogQuantity;
  if (quantityKey === undefined) {
    entry = requireLength(object);
  } else {
    const named = object.quantities[quantityKey];
    if (named === undefined) {
      throw new ComparisonError(`${object.id} has no quantity ${quantityKey}`);
    }
    entry = named;
  }

  return {
    label: `${object.name} (${entry.key})`,
    dimension: entry.dimension,
    value: entry.value,
    approximation: entry.approximation,
    ...(entry.range === undefined ? {} : { range: entry.range }),
    ...(entry.source === undefined ? {} : { source: entry.source }),
    ...(entry.note === undefined ? {} : { note: entry.note }),
  };
}

/** A unit literal such as `1 mm`. Exactly defined, so it carries no range. */
export function subjectFromQuantity(label: string, value: Quantity): Subject {
  return { label, dimension: value.dimension, value, approximation: 'exact' };
}

/** True when the subject is an exact definition rather than a measurement. */
export function isExactSubject(subject: Subject): boolean {
  return subject.approximation === 'exact' && subject.range === undefined;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type Certainty = 'exact' | 'approximate';

export interface RangeOf<T> {
  min: T;
  max: T;
}

interface ResultBase {
  operation: ComparisonOperation;
  a: Subject;
  b: Subject;
  /**
   * `exact` only when every input is an exact definition. The arithmetic itself
   * is always exact; this describes the inputs.
   */
  certainty: Certainty;
  /** Which subjects made the answer approximate, for the UI to name. */
  approximateBecause: readonly string[];
  /**
   * Modelling assumptions the answer rests on, which are a different thing from
   * `approximateBecause` and must not be folded into it.
   *
   * `approximateBecause` is about the *inputs*: this coconut is a representative
   * 0.2 m rather than a measured one. An assumption is about the *question*:
   * squaring a length ratio gives the ratio of areas only if the two objects are
   * the same shape, and no amount of precision in the lengths makes that true.
   * A house is not a large coconut.
   *
   * The same distinction the numerics core draws between operand encoding error
   * and operation rounding error (docs/NUMERICS.md §7): two ways to be wrong
   * that a single bucket would blur.
   */
  assumes?: readonly string[];
}

/** A dimensionless count: ratio and how-many-fit. */
export interface CountResult extends ResultBase {
  kind: 'count';
  value: Rational;
  range?: RangeOf<Rational>;
}

/** A quantity: difference and end-to-end. */
export interface QuantityResult extends ResultBase {
  kind: 'quantity';
  value: Quantity;
  range?: RangeOf<Quantity>;
  /** For end-to-end, how many were laid out. */
  count?: Rational;
}

export type ComparisonResult = CountResult | QuantityResult;

function requireSameDimension(a: Subject, b: Subject): void {
  if (a.dimension !== b.dimension) {
    throw new ComparisonError(
      `Cannot compare a ${a.dimension} with a ${b.dimension}. Pick a dimension both share.`,
    );
  }
}

function certaintyOf(
  subjects: readonly Subject[],
): Pick<ResultBase, 'certainty' | 'approximateBecause'> {
  const inexact = subjects.filter((subject) => !isExactSubject(subject));
  return {
    certainty: inexact.length === 0 ? 'exact' : 'approximate',
    approximateBecause: inexact.map((subject) => subject.label),
  };
}

const lowOf = (subject: Subject): Quantity => subject.range?.min ?? subject.value;
const highOf = (subject: Subject): Quantity => subject.range?.max ?? subject.value;

function hasRange(subjects: readonly Subject[]): boolean {
  return subjects.some((subject) => subject.range !== undefined);
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

/** `a / b`, dimensionless. */
export function ratio(a: Subject, b: Subject): CountResult {
  requireSameDimension(a, b);
  if (isZero(b.value.value)) {
    throw new ComparisonError(`${b.label} is zero; a ratio against it is undefined`);
  }

  const base: CountResult = {
    kind: 'count',
    operation: 'ratio',
    a,
    b,
    value: quantityRatio(a.value, b.value),
    ...certaintyOf([a, b]),
  };
  if (!hasRange([a, b])) return base;

  // Widest against narrowest, and the other way round.
  return {
    ...base,
    range: {
      min: quantityRatio(lowOf(a), highOf(b)),
      max: quantityRatio(highOf(a), lowOf(b)),
    },
  };
}

/**
 * How many of `a` span `b` — the "how many red blood cells fit across a
 * millimetre?" question. This is `b / a`, and the argument order matters.
 */
export function howManyFit(a: Subject, b: Subject): CountResult {
  return { ...ratio(b, a), operation: 'how-many-fit', a, b };
}

/**
 * Geometric similarity: the assumption that squaring and cubing a length ratio
 * is allowed at all.
 *
 * For two shapes that are *similar* — the same shape at different sizes — areas
 * go as the square of any corresponding length and volumes as the cube, exactly,
 * whatever the shape is. No shape factor is needed and none is invented here:
 * the factors cancel in a ratio. What does not cancel is the similarity itself.
 * A coconut and a house share one number, a length, and nothing else; the
 * catalog does not know their shapes and this function does not pretend to.
 *
 * So the arithmetic is exact and the claim is conditional, and the condition is
 * carried on the result rather than left in a comment.
 */
const SIMILARITY = 'both objects have the same shape, at different sizes';

function poweredRatio(
  a: Subject,
  b: Subject,
  power: 2 | 3,
  operation: 'area-ratio' | 'volume-ratio',
): CountResult {
  const lengths = ratio(a, b);
  const raise = (value: Rational): Rational =>
    power === 2 ? mul(value, value) : mul(mul(value, value), value);

  const base: CountResult = {
    ...lengths,
    operation,
    value: raise(lengths.value),
    assumes: [SIMILARITY],
  };
  if (lengths.range === undefined) {
    // `range` is optional, and spreading a result that has none would carry an
    // explicit `undefined` into a type that says the key may be absent.
    const withoutRange = { ...base };
    delete withoutRange.range;
    return withoutRange;
  }
  // Both bounds are positive and `x^n` is increasing there, so the extremes of
  // the range map to the extremes of the answer.
  return { ...base, range: { min: raise(lengths.range.min), max: raise(lengths.range.max) } };
}

/**
 * How many times the surface area, if the two are the same shape.
 *
 * §DATA_MODEL: "Future area/volume operations must use appropriate geometry
 * rather than blindly reusing length ratios." The geometry that applies to two
 * lengths and nothing else is similarity, and this says so out loud rather than
 * quietly cubing.
 */
export function areaRatio(a: Subject, b: Subject): CountResult {
  return poweredRatio(a, b, 2, 'area-ratio');
}

/** How many times the volume, if the two are the same shape. */
export function volumeRatio(a: Subject, b: Subject): CountResult {
  return poweredRatio(a, b, 3, 'volume-ratio');
}

/**
 * The packing model, in the words the panel shows.
 *
 * The volume ratio is not the answer to "how many fit inside", and the gap is
 * not small: spheres poured into a large container reach 0.6366 of its volume,
 * so `V_b / V_a` overstates the count by more than half. Naming the model is
 * what makes the operation offerable at all — this was left out of the area and
 * volume work precisely because there was no citable number for it, and there
 * is one.
 */
const POURED_SPHERES =
  `the smaller object pours and settles like an equal sphere, filling ` +
  `${packingFractionText()} of the space — ${RANDOM_CLOSE_PACKING.source}. ` +
  `The densest arrangement any equal spheres can reach is ` +
  `${DENSEST_SPHERE_PACKING_TEXT}, and pouring does not get there`;

/**
 * The packing fraction as its source published it.
 *
 * Held exactly as 3183/5000, and `3183/5000 of the space` is what the panel
 * first said — arithmetically right and unreadable, and not the form anyone
 * could check against the paper. `toExactDecimalString` returns `undefined` for
 * a repeating expansion rather than truncating; this one terminates, and the
 * fallback exists so a future constant that does not cannot print a lie.
 */
function packingFractionText(): string {
  return toExactDecimalString(RANDOM_CLOSE_PACKING.nominal) ?? 'its declared fraction';
}

/**
 * The condition under which a bulk packing fraction means anything.
 *
 * 0.6366 is a property of an arrangement far from any wall. Ask how many
 * coconuts fit in a slightly larger coconut and the answer the arithmetic gives
 * is one; the answer the packing model is entitled to give is none, because
 * there is no bulk. No threshold is invented here — inventing one would be a
 * third guess — so the condition is stated and the number is left to stand.
 */
const BULK =
  'the container is far larger than the item, so the walls do not dominate the arrangement';

/**
 * How many of `a` fit inside `b`, by volume.
 *
 * `b / a` cubed, times the packing fraction. The count is exact rational
 * arithmetic on three exact inputs and it is still conditional on all three
 * assumptions, which is the distinction `assumes` exists to keep: exact is not
 * the same as true.
 */
export function howManyFitByVolume(a: Subject, b: Subject): CountResult {
  const volumes = poweredRatio(b, a, 3, 'volume-ratio');
  const fraction = RANDOM_CLOSE_PACKING.nominal;

  const base: CountResult = {
    ...volumes,
    operation: 'how-many-fit-volume',
    a,
    b,
    value: mul(volumes.value, fraction),
    assumes: [SIMILARITY, POURED_SPHERES, BULK],
  };
  if (volumes.range === undefined) {
    const withoutRange = { ...base };
    delete withoutRange.range;
    return withoutRange;
  }
  // The packing fraction is positive, so scaling preserves the order of the
  // bounds. Its own ±0.0005 is deliberately not folded in: that is uncertainty
  // in the *model*, and `range` carries uncertainty in the inputs.
  return {
    ...base,
    range: { min: mul(volumes.range.min, fraction), max: mul(volumes.range.max, fraction) },
  };
}

/** `a - b`, a quantity. */
export function difference(a: Subject, b: Subject): QuantityResult {
  requireSameDimension(a, b);
  const base: QuantityResult = {
    kind: 'quantity',
    operation: 'difference',
    a,
    b,
    value: subQuantity(a.value, b.value),
    ...certaintyOf([a, b]),
  };
  if (!hasRange([a, b])) return base;

  return {
    ...base,
    range: {
      min: subQuantity(lowOf(a), highOf(b)),
      max: subQuantity(highOf(a), lowOf(b)),
    },
  };
}

/**
 * `count` of `a` laid end to end — `123 × coconut`.
 *
 * The count is exact; the extent is only as well known as the object. Asking
 * for "123 coconuts" without naming a dimension is incomplete, which is why
 * this takes a subject rather than an object.
 */
export function endToEnd(a: Subject, count: Rational): QuantityResult {
  if (count.numerator < 0n) {
    throw new ComparisonError('Cannot lay out a negative count');
  }
  const base: QuantityResult = {
    kind: 'quantity',
    operation: 'end-to-end',
    a,
    b: a,
    value: scale(a.value, count),
    count,
    ...certaintyOf([a]),
  };
  if (a.range === undefined) return base;

  return {
    ...base,
    range: { min: scale(a.range.min, count), max: scale(a.range.max, count) },
  };
}

/**
 * How many of `a` are needed to span `b`, rounded up to a whole item — the
 * count you would actually have to lay out.
 */
export function wholeItemsToSpan(a: Subject, b: Subject): { count: bigint; remainder: Quantity } {
  const exactCount = howManyFit(a, b).value;
  const whole = ceilBigInt(exactCount);
  const covered = scale(a.value, { numerator: whole, denominator: 1n });
  return { count: whole, remainder: subQuantity(covered, b.value) };
}

function ceilBigInt(value: Rational): bigint {
  const quotient = value.numerator / value.denominator;
  return value.numerator > 0n && quotient * value.denominator !== value.numerator
    ? quotient + 1n
    : quotient;
}

/* -------------------------------------------------------------------------- */
/* Uncertainty                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Half the spread of a count result as a fraction of its central value, or
 * `undefined` when there is no range. Lets the UI decide how many digits are
 * worth showing.
 */
export function relativeSpread(result: CountResult): Rational | undefined {
  if (result.range === undefined || isZero(result.value)) return undefined;
  const spread = subRational(result.range.max, result.range.min);
  return abs(div(mul(spread, { numerator: 1n, denominator: 2n }), result.value));
}
