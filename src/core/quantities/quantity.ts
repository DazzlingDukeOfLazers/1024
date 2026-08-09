/**
 * Exact physical quantities.
 *
 * A `Quantity` always stores its value in the dimension's canonical SI unit as
 * an exact rational. Display units are a separate concern entirely — changing
 * how a quantity is shown must never change what it is (CLAUDE.md rule,
 * docs/ARCHITECTURE.md "State model").
 */

import {
  type Rational,
  ZERO,
  add as addRational,
  compare as compareRational,
  div as divRational,
  equals as equalsRational,
  isZero,
  mul as mulRational,
  neg as negRational,
  sub as subRational,
} from '../rational/rational';
import { type DimensionKind } from '../units/dimensions';
import { UnitError, requireUnit } from '../units/units';

export interface Quantity<D extends DimensionKind = DimensionKind> {
  readonly dimension: D;
  /** Exact magnitude expressed in `canonicalUnitOf(dimension)`. */
  readonly value: Rational;
}

export function quantity<D extends DimensionKind>(dimension: D, value: Rational): Quantity<D> {
  return { dimension, value };
}

export function zeroQuantity<D extends DimensionKind>(dimension: D): Quantity<D> {
  return { dimension, value: ZERO };
}

/** Build a quantity from a value expressed in `unitSymbol`, converting exactly. */
export function fromUnit(value: Rational, unitSymbol: string): Quantity {
  const unit = requireUnit(unitSymbol);
  return { dimension: unit.dimension, value: mulRational(value, unit.toCanonical) };
}

/** Exact magnitude of a quantity expressed in `unitSymbol`. */
export function toUnit(q: Quantity, unitSymbol: string): Rational {
  const unit = requireUnit(unitSymbol);
  if (unit.dimension !== q.dimension) {
    throw new UnitError(`Cannot express a ${q.dimension} quantity in ${unit.symbol}`);
  }
  return divRational(q.value, unit.toCanonical);
}

function requireSameDimension(a: Quantity, b: Quantity): void {
  if (a.dimension !== b.dimension) {
    throw new UnitError(`Dimension mismatch: ${a.dimension} vs ${b.dimension}`);
  }
}

export function add<D extends DimensionKind>(a: Quantity<D>, b: Quantity<D>): Quantity<D> {
  requireSameDimension(a, b);
  return { dimension: a.dimension, value: addRational(a.value, b.value) };
}

export function sub<D extends DimensionKind>(a: Quantity<D>, b: Quantity<D>): Quantity<D> {
  requireSameDimension(a, b);
  return { dimension: a.dimension, value: subRational(a.value, b.value) };
}

export function negate<D extends DimensionKind>(q: Quantity<D>): Quantity<D> {
  return { dimension: q.dimension, value: negRational(q.value) };
}

/** Scale by a dimensionless factor. */
export function scale<D extends DimensionKind>(q: Quantity<D>, factor: Rational): Quantity<D> {
  return { dimension: q.dimension, value: mulRational(q.value, factor) };
}

/**
 * Dimensionless ratio of two quantities of the same dimension.
 *
 * This is the exact answer behind "how many X fit across Y" — the comparator
 * decides separately whether the *inputs* were exact or representative
 * (docs/DATA_MODEL.md).
 */
export function ratio(a: Quantity, b: Quantity): Rational {
  requireSameDimension(a, b);
  if (isZero(b.value)) {
    throw new UnitError('Ratio against a zero quantity is undefined');
  }
  return divRational(a.value, b.value);
}

export function compare(a: Quantity, b: Quantity): -1 | 0 | 1 {
  requireSameDimension(a, b);
  return compareRational(a.value, b.value);
}

export function equals(a: Quantity, b: Quantity): boolean {
  return a.dimension === b.dimension && equalsRational(a.value, b.value);
}
