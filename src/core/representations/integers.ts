/**
 * Finite signed integer semantics.
 *
 * docs/NUMERICS.md §2: JavaScript `BigInt` is implementation storage, not
 * simulated width. Nothing in a simulated machine may quietly inherit BigInt's
 * unbounded range, so every write to a register goes through {@link storeSigned}
 * and every out-of-range write produces an event.
 */

export class RegisterWidthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterWidthError';
  }
}

function requireWidth(width: number): void {
  if (!Number.isInteger(width) || width < 2) {
    throw new RegisterWidthError(`Signed register width must be an integer >= 2, got ${width}`);
  }
}

/** Lowest value a signed register of this width can hold: -2^(width-1). */
export function signedMin(width: number): bigint {
  requireWidth(width);
  return -(1n << BigInt(width - 1));
}

/** Highest value a signed register of this width can hold: 2^(width-1) - 1. */
export function signedMax(width: number): bigint {
  requireWidth(width);
  return (1n << BigInt(width - 1)) - 1n;
}

export function fitsSigned(width: number, value: bigint): boolean {
  return value >= signedMin(width) && value <= signedMax(width);
}

/** Two's-complement wrap into range. */
export function wrapSigned(width: number, value: bigint): bigint {
  requireWidth(width);
  const modulus = 1n << BigInt(width);
  let wrapped = value % modulus;
  if (wrapped < 0n) wrapped += modulus;
  if (wrapped >= modulus >> 1n) wrapped -= modulus;
  return wrapped;
}

/** Saturate to the nearest representable bound. */
export function clampSigned(width: number, value: bigint): bigint {
  const low = signedMin(width);
  const high = signedMax(width);
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** Unsigned two's-complement bit pattern of a signed value. */
export function toTwosComplement(width: number, value: bigint): bigint {
  if (!fitsSigned(width, value)) {
    throw new RegisterWidthError(`${value} does not fit in a signed ${width}-bit register`);
  }
  return value < 0n ? value + (1n << BigInt(width)) : value;
}

/** Interpret an unsigned bit pattern as a signed value. */
export function fromTwosComplement(width: number, raw: bigint): bigint {
  requireWidth(width);
  const modulus = 1n << BigInt(width);
  if (raw < 0n || raw >= modulus) {
    throw new RegisterWidthError(`${raw} is not a ${width}-bit pattern`);
  }
  return raw >= modulus >> 1n ? raw - modulus : raw;
}

/** Fixed-width hex of the two's-complement pattern, e.g. `0x00…01`. */
export function toHex(width: number, value: bigint): string {
  const digits = Math.ceil(width / 4);
  return `0x${toTwosComplement(width, value).toString(16).padStart(digits, '0')}`;
}

export function fromHex(width: number, hex: string): bigint {
  const text = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(text)) {
    throw new RegisterWidthError(`Not a hex register pattern: ${JSON.stringify(hex)}`);
  }
  return fromTwosComplement(width, BigInt(`0x${text}`));
}

/** Fixed-width binary of the two's-complement pattern. */
export function toBinary(width: number, value: bigint): string {
  return toTwosComplement(width, value).toString(2).padStart(width, '0');
}

/* -------------------------------------------------------------------------- */
/* Overflow                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Default is `checked`: the write is refused and reported. Wrapping and
 * saturation are selectable for demonstrations but never happen silently.
 */
export type OverflowMode = 'checked' | 'wrap' | 'saturate';

export interface OverflowEvent {
  width: number;
  /** The mathematically correct value the machine was asked to store. */
  requested: bigint;
  direction: 'above' | 'below';
  mode: OverflowMode;
  /** What the register ended up holding; absent when the write was refused. */
  stored?: bigint;
}

export type StoreResult =
  | { status: 'stored'; value: bigint }
  | { status: 'wrapped'; value: bigint; overflow: OverflowEvent }
  | { status: 'saturated'; value: bigint; overflow: OverflowEvent }
  | { status: 'rejected'; overflow: OverflowEvent };

/** The only way a value may enter a simulated register. */
export function storeSigned(width: number, value: bigint, mode: OverflowMode): StoreResult {
  if (fitsSigned(width, value)) {
    return { status: 'stored', value };
  }
  const direction: 'above' | 'below' = value > signedMax(width) ? 'above' : 'below';

  switch (mode) {
    case 'checked':
      return { status: 'rejected', overflow: { width, requested: value, direction, mode } };
    case 'wrap': {
      const stored = wrapSigned(width, value);
      return {
        status: 'wrapped',
        value: stored,
        overflow: { width, requested: value, direction, mode, stored },
      };
    }
    case 'saturate': {
      const stored = clampSigned(width, value);
      return {
        status: 'saturated',
        value: stored,
        overflow: { width, requested: value, direction, mode, stored },
      };
    }
  }
}

/** Convenience for callers that treat a refused write as fatal. */
export function isOverflowed(
  result: StoreResult,
): result is Exclude<StoreResult, { status: 'stored' }> {
  return result.status !== 'stored';
}
