/**
 * Radix-2^N digit decomposition, and how much of a wide register is actually
 * doing anything.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §2–§4. The hypothesis this serves is that a
 * machine can expose very wide architectural values while doing the arithmetic
 * on a much smaller physical slice over several cycles — so the first thing to
 * build is not an operation but a measurement. A declared 1024-bit value does
 * not automatically require 1024 bits of useful work, and the simulator has to
 * report the declared width and the significant width separately or there is
 * nothing to compare.
 *
 * Everything here is exact. Splitting on a power-of-two boundary is a shift and
 * a mask, which introduces no approximation at all (§2), so this module never
 * rounds and never needs a policy. Rounding arrives with `NARROW`, deliberately
 * and later.
 */

export const DIGIT_WIDTHS = [8, 16, 32, 64, 128] as const;
export type DigitWidth = (typeof DIGIT_WIDTHS)[number];

export class WideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WideError';
  }
}

/**
 * Number of bits in the binary expansion of a non-negative value: `BITLEN`.
 * Zero has none, which is the convention `CLZ` on an all-zero register needs.
 */
export function bitLength(value: bigint): number {
  if (value < 0n) throw new WideError('bitLength is defined on magnitudes');
  if (value === 0n) return 0;
  return value.toString(2).length;
}

/** Leading zeros within a declared register width: `CLZ`. */
export function leadingZeros(value: bigint, registerBits: number): number {
  const used = bitLength(value);
  if (used > registerBits) {
    throw new WideError(`value needs ${used} bits, register declares ${registerBits}`);
  }
  return registerBits - used;
}

/**
 * Trailing zeros: `CTZ`. Undefined for zero, which has no lowest set bit — the
 * caller decides what that means rather than being handed a plausible number.
 */
export function trailingZeros(value: bigint): number | undefined {
  if (value < 0n) throw new WideError('trailingZeros is defined on magnitudes');
  if (value === 0n) return undefined;
  let count = 0;
  let remaining = value;
  while ((remaining & 1n) === 0n) {
    remaining >>= 1n;
    count += 1;
  }
  return count;
}

/**
 * Split a magnitude into radix-2^N digits, least significant first.
 *
 * `A = Σ ai × 2^(N·i)`. With `registerBits` given, the array is padded to the
 * full digit count so a caller can talk about "digit 12 of 16" without checking
 * whether it happens to be present.
 */
export function toDigits(value: bigint, digitBits: DigitWidth, registerBits?: number): bigint[] {
  if (value < 0n) throw new WideError('toDigits is defined on magnitudes');
  const mask = (1n << BigInt(digitBits)) - 1n;
  const digits: bigint[] = [];
  let remaining = value;
  while (remaining > 0n) {
    digits.push(remaining & mask);
    remaining >>= BigInt(digitBits);
  }

  if (registerBits === undefined) return digits.length === 0 ? [0n] : digits;

  const count = Math.ceil(registerBits / digitBits);
  if (digits.length > count) {
    throw new WideError(
      `value needs ${digits.length} digits of ${digitBits} bits, register holds ${count}`,
    );
  }
  while (digits.length < count) digits.push(0n);
  return digits;
}

/** Reassemble digits, least significant first. Exactly inverts `toDigits`. */
export function fromDigits(digits: readonly bigint[], digitBits: DigitWidth): bigint {
  let value = 0n;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits[index]!;
    if (digit < 0n || digit >= 1n << BigInt(digitBits)) {
      throw new WideError(`digit ${digit} does not fit ${digitBits} bits`);
    }
    value = (value << BigInt(digitBits)) | digit;
  }
  return value;
}

/**
 * Which execution path a value's significant width calls for (§3).
 *
 * The boundaries are the ones the document names. They are a dispatch policy
 * rather than a law, and the simulator exists to measure whether the policy was
 * a good one.
 */
export type ExecutionPath = 'tiny' | 'native' | 'medium' | 'wide';

export function dispatchFor(significantBits: number): ExecutionPath {
  if (significantBits <= 16) return 'tiny';
  if (significantBits <= 64) return 'native';
  if (significantBits <= 128) return 'medium';
  return 'wide';
}

export interface DigitProfile {
  /** Width the register declares, whatever it happens to hold. */
  readonly declaredBits: number;
  /** Bits actually occupied: `BITLEN`. Zero for a zero register. */
  readonly significantBits: number;
  readonly digitBits: DigitWidth;
  /** Every digit, least significant first, padded to the declared width. */
  readonly digits: readonly bigint[];
  /** How many of them are non-zero — the ones a multiply cannot skip (§4). */
  readonly nonzeroDigits: number;
  /** Index of the highest non-zero digit, or `undefined` for zero. */
  readonly highestNonzero?: number | undefined;
  readonly lowestNonzero?: number | undefined;
  readonly path: ExecutionPath;
}

/**
 * What a wide register is actually carrying.
 *
 * The interesting number is `nonzeroDigits` against `digits.length`: a value
 * like `2^700 + 2^12` occupies a 1024-bit register and holds information in two
 * digits of sixteen. Whether skipping the other fourteen is worth its control
 * cost is the experiment, and this is the measurement it needs.
 */
export function profile(value: bigint, digitBits: DigitWidth, registerBits: number): DigitProfile {
  if (value < 0n) throw new WideError('profile is defined on magnitudes');
  const digits = toDigits(value, digitBits, registerBits);

  let nonzeroDigits = 0;
  let highestNonzero: number | undefined;
  let lowestNonzero: number | undefined;
  for (let index = 0; index < digits.length; index += 1) {
    if (digits[index] === 0n) continue;
    nonzeroDigits += 1;
    highestNonzero = index;
    if (lowestNonzero === undefined) lowestNonzero = index;
  }

  const significantBits = bitLength(value);
  return {
    declaredBits: registerBits,
    significantBits,
    digitBits,
    digits,
    nonzeroDigits,
    ...(highestNonzero === undefined ? {} : { highestNonzero }),
    ...(lowestNonzero === undefined ? {} : { lowestNonzero }),
    path: dispatchFor(significantBits),
  };
}

/**
 * Partial products a digit-serial multiply would face, and how many of them the
 * zero digits let it skip (§4, §20).
 *
 * Reported rather than assumed to be free: the document is explicit that the
 * control cost of skipping is itself configurable, and a count of skipped work
 * is only half of that argument.
 */
export interface PartialProductCount {
  readonly possible: number;
  readonly executed: number;
  readonly skipped: number;
}

export function partialProducts(a: DigitProfile, b: DigitProfile): PartialProductCount {
  if (a.digitBits !== b.digitBits) {
    throw new WideError('partial products need a common digit width');
  }
  const possible = a.digits.length * b.digits.length;
  const executed = a.nonzeroDigits * b.nonzeroDigits;
  return { possible, executed, skipped: possible - executed };
}
