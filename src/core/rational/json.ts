/**
 * Serialization for exact rationals.
 *
 * docs/NUMERICS.md §14: never serialize BigInt as a JSON number. Every exact
 * value crosses a JSON boundary as a pair of decimal strings.
 */

import { type Rational, RationalError, rational } from './rational';

/** Wire shape; matches `ExactRationalJSON` in docs/DATA_MODEL.md. */
export interface RationalJSON {
  numerator: string;
  denominator: string;
}

export function toJSON(value: Rational): RationalJSON {
  return {
    numerator: value.numerator.toString(10),
    denominator: value.denominator.toString(10),
  };
}

export function fromJSON(value: RationalJSON): Rational {
  if (typeof value?.numerator !== 'string' || typeof value?.denominator !== 'string') {
    throw new RationalError('RationalJSON requires string numerator and denominator');
  }
  if (!/^[+-]?\d+$/.test(value.numerator) || !/^[+-]?\d+$/.test(value.denominator)) {
    throw new RationalError(
      `RationalJSON fields must be integer strings: ${JSON.stringify(value)}`,
    );
  }
  return rational(BigInt(value.numerator), BigInt(value.denominator));
}

/** Compact single-string encoding, e.g. `"1/1000"`. Used by share URLs. */
export function toCompactString(value: Rational): string {
  return value.denominator === 1n
    ? value.numerator.toString(10)
    : `${value.numerator.toString(10)}/${value.denominator.toString(10)}`;
}
