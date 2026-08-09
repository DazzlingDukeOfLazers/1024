/**
 * SI prefixes with exact rational factors.
 *
 * Engineering notation (CLAUDE.md rule 9) is the default display language, so
 * the powers-of-1000 subset is called out separately from the full SI set.
 */

import { type Rational, pow10 } from '../rational/rational';

export interface SiPrefix {
  symbol: string;
  name: string;
  exponent: number;
}

/** Full SI prefix set, descending by exponent. */
export const SI_PREFIXES: readonly SiPrefix[] = [
  { symbol: 'Q', name: 'quetta', exponent: 30 },
  { symbol: 'R', name: 'ronna', exponent: 27 },
  { symbol: 'Y', name: 'yotta', exponent: 24 },
  { symbol: 'Z', name: 'zetta', exponent: 21 },
  { symbol: 'E', name: 'exa', exponent: 18 },
  { symbol: 'P', name: 'peta', exponent: 15 },
  { symbol: 'T', name: 'tera', exponent: 12 },
  { symbol: 'G', name: 'giga', exponent: 9 },
  { symbol: 'M', name: 'mega', exponent: 6 },
  { symbol: 'k', name: 'kilo', exponent: 3 },
  { symbol: 'h', name: 'hecto', exponent: 2 },
  { symbol: 'da', name: 'deca', exponent: 1 },
  { symbol: '', name: '', exponent: 0 },
  { symbol: 'd', name: 'deci', exponent: -1 },
  { symbol: 'c', name: 'centi', exponent: -2 },
  { symbol: 'm', name: 'milli', exponent: -3 },
  { symbol: 'µ', name: 'micro', exponent: -6 },
  { symbol: 'n', name: 'nano', exponent: -9 },
  { symbol: 'p', name: 'pico', exponent: -12 },
  { symbol: 'f', name: 'femto', exponent: -15 },
  { symbol: 'a', name: 'atto', exponent: -18 },
  { symbol: 'z', name: 'zepto', exponent: -21 },
  { symbol: 'y', name: 'yocto', exponent: -24 },
  { symbol: 'r', name: 'ronto', exponent: -27 },
  { symbol: 'q', name: 'quecto', exponent: -30 },
];

/** The powers-of-1000 subset, descending. This is what engineering notation uses. */
export const ENGINEERING_PREFIXES: readonly SiPrefix[] = SI_PREFIXES.filter(
  (prefix) => prefix.exponent % 3 === 0,
);

const LARGEST_ENGINEERING_EXPONENT = 30;
const SMALLEST_ENGINEERING_EXPONENT = -30;

/** Alternative spellings accepted on input; canonical output always uses `µ`. */
const PREFIX_ALIASES: Readonly<Record<string, string>> = {
  u: 'µ',
  μ: 'µ', // GREEK SMALL LETTER MU
};

const BY_SYMBOL = new Map<string, SiPrefix>(SI_PREFIXES.map((p) => [p.symbol, p]));

export function prefixBySymbol(symbol: string): SiPrefix | undefined {
  return BY_SYMBOL.get(PREFIX_ALIASES[symbol] ?? symbol);
}

export function prefixByExponent(exponent: number): SiPrefix | undefined {
  return SI_PREFIXES.find((p) => p.exponent === exponent);
}

export function prefixFactor(prefix: SiPrefix): Rational {
  return pow10(prefix.exponent);
}

/**
 * The engineering prefix exponent for a value of the given decimal order of
 * magnitude, clamped to the prefixes SI actually defines. Beyond quetta or
 * below quecto the mantissa is allowed to leave [1, 1000) rather than
 * inventing a prefix.
 */
export function engineeringExponentFor(orderOfMagnitude: number): number {
  const stepped = Math.floor(orderOfMagnitude / 3) * 3;
  return Math.min(LARGEST_ENGINEERING_EXPONENT, Math.max(SMALLEST_ENGINEERING_EXPONENT, stepped));
}
