/**
 * Reading a wide operand from what someone typed.
 *
 * A 1024-bit register's interesting values are not ones anybody wants to write
 * in decimal. `2^700 + 2^12` is §4's own example of a sparse wide value and it
 * is 211 digits long written out, so the input accepts sums and differences of
 * powers of two and plain integers.
 *
 * Everything is exact. The parser produces a `bigint` and never touches
 * `Number`, for the same reason the rest of this project does not: a value the
 * user typed should survive being read.
 */

import { WideError } from './digits';

const TERM = /^\s*(-)?\s*(?:(\d+)\s*\^\s*(\d+)|(\d+))\s*$/;

/**
 * Parse `2^700 + 2^12`, `-5`, `12345`, `2^64 - 1`.
 *
 * Deliberately small: this is an operand box in an experiment lab, not an
 * expression language. Anything it cannot read, it refuses by name rather than
 * guessing.
 */
export function parseWideLiteral(text: string): bigint {
  const trimmed = text.trim();
  if (trimmed === '') throw new WideError('empty operand');

  // Split on + and - while keeping the sign with the term that follows it.
  const terms: { sign: bigint; body: string }[] = [];
  let sign = 1n;
  let start = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if ((character !== '+' && character !== '-') || index === 0) continue;
    // A sign directly after `^` or another operator belongs to the exponent or
    // to the next term, not to a split point.
    const previous = trimmed.slice(0, index).trimEnd().at(-1);
    if (previous === '^' || previous === '+' || previous === '-') continue;
    terms.push({ sign, body: trimmed.slice(start, index) });
    sign = character === '-' ? -1n : 1n;
    start = index + 1;
  }
  terms.push({ sign, body: trimmed.slice(start) });

  let total = 0n;
  for (const term of terms) {
    const match = TERM.exec(term.body);
    if (match === null) {
      throw new WideError(
        `cannot read "${term.body.trim()}" — expected an integer or a power like 2^700`,
      );
    }
    const [, negative, base, exponent, plain] = match;
    const magnitude =
      plain !== undefined ? BigInt(plain) : BigInt(base!) ** BigInt(Number(exponent!));
    total += term.sign * (negative === undefined ? magnitude : -magnitude);
  }
  return total;
}

/**
 * A wide value written short enough to read.
 *
 * A 1024-bit product is around three hundred decimal digits, which is not a
 * number anyone reads — but the count of digits is itself informative, so it is
 * kept rather than replaced with an ellipsis alone.
 */
export function describeWideLiteral(value: bigint): string {
  const digits = (value < 0n ? -value : value).toString(10);
  const sign = value < 0n ? '-' : '';
  if (digits.length <= 20) return sign + digits;
  return `${sign}${digits.slice(0, 6)}…${digits.slice(-6)} (${digits.length} digits)`;
}
