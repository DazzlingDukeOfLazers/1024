/**
 * Unit registry and exact conversion factors.
 *
 * Only conversions SI defines exactly live here. Anything measured (a red
 * blood cell, the Planck length) belongs to the catalog or to a declared
 * constant with provenance — not to this table (docs/NUMERICS.md §3).
 */

import { type Rational, div, ONE, rational } from '../rational/rational';
import { type DimensionKind } from './dimensions';
import { type SiPrefix, prefixBySymbol, prefixFactor } from './prefixes';

export interface UnitDefinition {
  /** Canonical symbol, e.g. `mm`. */
  symbol: string;
  name: string;
  dimension: DimensionKind;
  /** Exact multiplier from this unit to the dimension's canonical SI unit. */
  toCanonical: Rational;
  prefix?: SiPrefix;
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

interface BaseUnit {
  symbol: string;
  name: string;
  dimension: DimensionKind;
}

/** Base units that accept SI prefixes. */
const PREFIXABLE_BASES: readonly BaseUnit[] = [
  { symbol: 'm', name: 'metre', dimension: 'length' },
  { symbol: 's', name: 'second', dimension: 'time' },
];

/**
 * Units that are exactly defined but do not take prefixes. Kept out of the
 * prefix decomposition so `da` never parses as "deci-annum".
 */
const FIXED_UNITS: readonly UnitDefinition[] = [
  { symbol: 'min', name: 'minute', dimension: 'time', toCanonical: rational(60n) },
  { symbol: 'h', name: 'hour', dimension: 'time', toCanonical: rational(3600n) },
  { symbol: 'd', name: 'day', dimension: 'time', toCanonical: rational(86400n) },
  { symbol: 'a', name: 'Julian year', dimension: 'time', toCanonical: rational(31557600n) },
];

const FIXED_BY_SYMBOL = new Map(FIXED_UNITS.map((unit) => [unit.symbol, unit]));
const BASE_BY_SYMBOL = new Map(PREFIXABLE_BASES.map((base) => [base.symbol, base]));

function unitFromBase(base: BaseUnit, prefix: SiPrefix): UnitDefinition {
  const definition: UnitDefinition = {
    symbol: `${prefix.symbol}${base.symbol}`,
    name: `${prefix.name}${base.name}`,
    dimension: base.dimension,
    toCanonical: prefix.exponent === 0 ? ONE : prefixFactor(prefix),
  };
  return prefix.exponent === 0 ? definition : { ...definition, prefix };
}

/** Resolve a unit symbol, or `undefined` if it is not a unit we define. */
export function findUnit(symbol: string): UnitDefinition | undefined {
  const fixed = FIXED_BY_SYMBOL.get(symbol);
  if (fixed) return fixed;

  const base = BASE_BY_SYMBOL.get(symbol);
  if (base) {
    return unitFromBase(base, { symbol: '', name: '', exponent: 0 });
  }

  for (const candidate of PREFIXABLE_BASES) {
    if (symbol.length > candidate.symbol.length && symbol.endsWith(candidate.symbol)) {
      const prefixSymbol = symbol.slice(0, symbol.length - candidate.symbol.length);
      const prefix = prefixBySymbol(prefixSymbol);
      if (prefix && prefix.exponent !== 0) {
        return unitFromBase(candidate, prefix);
      }
    }
  }
  return undefined;
}

export function requireUnit(symbol: string): UnitDefinition {
  const unit = findUnit(symbol);
  if (!unit) {
    throw new UnitError(`Unknown unit symbol: ${JSON.stringify(symbol)}`);
  }
  return unit;
}

/** Exact factor converting `from` into `to`. Throws across dimensions. */
export function conversionFactor(from: UnitDefinition, to: UnitDefinition): Rational {
  if (from.dimension !== to.dimension) {
    throw new UnitError(
      `Cannot convert ${from.symbol} (${from.dimension}) to ${to.symbol} (${to.dimension})`,
    );
  }
  return div(from.toCanonical, to.toCanonical);
}
