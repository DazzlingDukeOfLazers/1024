/**
 * The u32-limb machine: one 1024-bit value as 32 × u32, limb 0 least
 * significant.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §17–§18. This is the CPU simulation the
 * WebGPU track is checked against — which only means something if the kernels
 * here are constrained the way a shader is. So: `bigint` appears in
 * `toLimbs`/`fromLimbs` and nowhere else, every arithmetic step is reduced to
 * u32 immediately (`>>> 0`), carries and borrows are detected by comparison
 * because u32 addition wraps silently, and 32×32→64 is assembled from 16-bit
 * halves because WGSL has no 64-bit integers at all. A kernel that quietly
 * leaned on JavaScript's wide doubles would simulate nothing.
 *
 * The Python prototype in `tools/oracle.py` fixed the algorithms and the facts
 * worth knowing before this file existed: the carry-by-comparison idiom cannot
 * produce a carry of two, and DIV_REM's remainder register needs no extra limb
 * (after k bits of dividend, R ≤ 2^k − 1). This file inherits both as checked
 * invariants rather than re-deriving them.
 *
 * §20: every kernel reports its work. The counts are primitive events — u32
 * additions, 16×16→32 multiplies, comparisons, per-limb shifts — with a flat
 * cycle each, so the model is explainable rather than tuned.
 */

import { WideError } from '../wide/digits';

export const LIMB_BITS = 32;
export const LIMBS_PER_VALUE = 32; // 1024 bits
export const PRODUCT_LIMBS = 2 * LIMBS_PER_VALUE;

export interface LimbMetrics {
  /** u32 additions, including carry and borrow bookkeeping. */
  readonly add32: number;
  /** 16×16→32 primitive multiplies — four per 32×32 partial product. */
  readonly mul16: number;
  readonly compare32: number;
  /** Per-limb shift-and-mask moves. */
  readonly shift32: number;
  readonly modeledCycles: number;
}

interface Tally {
  add32: number;
  mul16: number;
  compare32: number;
  shift32: number;
}

const tally = (): Tally => ({ add32: 0, mul16: 0, compare32: 0, shift32: 0 });

const finish = (t: Tally): LimbMetrics => ({
  ...t,
  modeledCycles: t.add32 + t.mul16 + t.compare32 + t.shift32,
});

/* -------------------------------------------------------------------------- */
/* The boundary: the only lines allowed to touch bigint                        */
/* -------------------------------------------------------------------------- */

export function toLimbs(value: bigint, count = LIMBS_PER_VALUE): Uint32Array {
  if (value < 0n || value >= 1n << BigInt(LIMB_BITS * count)) {
    throw new WideError(`value does not fit ${count} limbs of ${LIMB_BITS} bits`);
  }
  const limbs = new Uint32Array(count);
  let rest = value;
  for (let i = 0; i < count; i += 1) {
    limbs[i] = Number(rest & 0xffffffffn);
    rest >>= 32n;
  }
  return limbs;
}

export function fromLimbs(limbs: Uint32Array): bigint {
  let value = 0n;
  for (let i = limbs.length - 1; i >= 0; i -= 1) {
    value = (value << 32n) | BigInt(limbs[i]!);
  }
  return value;
}

const requireWidth = (limbs: Uint32Array, label: string): void => {
  if (limbs.length !== LIMBS_PER_VALUE) {
    throw new WideError(`${label} has ${limbs.length} limbs; the machine takes ${LIMBS_PER_VALUE}`);
  }
};

/* -------------------------------------------------------------------------- */
/* ADD / SUB                                                                   */
/* -------------------------------------------------------------------------- */

export interface LimbSum {
  readonly limbs: Uint32Array;
  /** The 1025th bit: the addition wrapped the register. */
  readonly carryOut: boolean;
  readonly metrics: LimbMetrics;
}

export function addLimbs(a: Uint32Array, b: Uint32Array): LimbSum {
  requireWidth(a, 'ADD left operand');
  requireWidth(b, 'ADD right operand');
  const t = tally();
  const out = new Uint32Array(LIMBS_PER_VALUE);
  let carry = 0;
  for (let i = 0; i < LIMBS_PER_VALUE; i += 1) {
    // The WGSL idiom, exactly: u32 addition wraps silently, and a wrapped sum
    // is smaller than either operand. The prototype proved c1 and c2 cannot
    // both fire — a wrapped first sum is at most 2^32 − 2, and adding a carry
    // of one to that cannot wrap again — so `carry` stays a single bit.
    const sum1 = (a[i]! + b[i]!) >>> 0;
    const c1 = sum1 < a[i]! ? 1 : 0;
    const sum2 = (sum1 + carry) >>> 0;
    const c2 = sum2 < sum1 ? 1 : 0;
    out[i] = sum2;
    carry = c1 + c2;
    t.add32 += 2;
    t.compare32 += 2;
  }
  return { limbs: out, carryOut: carry === 1, metrics: finish(t) };
}

export interface LimbDifference {
  readonly limbs: Uint32Array;
  /** The subtraction wrapped: the right operand was larger. */
  readonly borrowOut: boolean;
  readonly metrics: LimbMetrics;
}

export function subLimbs(a: Uint32Array, b: Uint32Array): LimbDifference {
  if (a.length !== b.length) {
    throw new WideError('SUB operands must have the same width');
  }
  const t = tally();
  const out = new Uint32Array(a.length);
  let borrow = 0;
  for (let i = 0; i < a.length; i += 1) {
    // Mirror image of the carry idiom: a wrapped difference is larger than the
    // minuend. b1 and b2 cannot both fire — a first wrap leaves at least 1,
    // and subtracting a borrow of one from that cannot wrap again.
    const diff1 = (a[i]! - b[i]!) >>> 0;
    const b1 = a[i]! < b[i]! ? 1 : 0;
    const diff2 = (diff1 - borrow) >>> 0;
    const b2 = diff1 < borrow ? 1 : 0;
    out[i] = diff2;
    borrow = b1 + b2;
    t.add32 += 2;
    t.compare32 += 2;
  }
  return { limbs: out, borrowOut: borrow === 1, metrics: finish(t) };
}

/* -------------------------------------------------------------------------- */
/* BITLEN / SHL / SHR                                                          */
/* -------------------------------------------------------------------------- */

export interface LimbBitLength {
  readonly bitLength: number;
  readonly metrics: LimbMetrics;
}

export function bitLengthLimbs(limbs: Uint32Array): LimbBitLength {
  const t = tally();
  for (let i = limbs.length - 1; i >= 0; i -= 1) {
    t.compare32 += 1;
    if (limbs[i]! !== 0) {
      // `clz32` is the u32 primitive WGSL spells `countLeadingZeros`.
      return { bitLength: LIMB_BITS * i + (32 - Math.clz32(limbs[i]!)), metrics: finish(t) };
    }
  }
  return { bitLength: 0, metrics: finish(t) };
}

export interface LimbShift {
  readonly limbs: Uint32Array;
  readonly metrics: LimbMetrics;
}

/**
 * SHL within the register; bits past the top fall off, as they do in hardware.
 * The limb-aligned case branches rather than shifting by `32 − 0`, because a
 * u32 shift by 32 is not a defined route to zero in WGSL — the amount is
 * masked, so `x >> 32` is `x`, silently.
 */
export function shlLimbs(limbs: Uint32Array, shift: number): LimbShift {
  requireWidth(limbs, 'SHL operand');
  if (!Number.isInteger(shift) || shift < 0 || shift >= LIMB_BITS * LIMBS_PER_VALUE) {
    throw new WideError(`SHL by ${shift} is outside the register`);
  }
  const t = tally();
  const limbOffset = Math.floor(shift / LIMB_BITS);
  const bitOffset = shift % LIMB_BITS;
  const out = new Uint32Array(LIMBS_PER_VALUE);
  for (let i = 0; i < LIMBS_PER_VALUE; i += 1) {
    const source = i - limbOffset;
    t.shift32 += 1;
    if (source < 0) {
      out[i] = 0;
    } else if (bitOffset === 0) {
      out[i] = limbs[source]!;
    } else {
      const low = (limbs[source]! << bitOffset) >>> 0;
      const high = source > 0 ? limbs[source - 1]! >>> (LIMB_BITS - bitOffset) : 0;
      out[i] = (low | high) >>> 0;
    }
  }
  return { limbs: out, metrics: finish(t) };
}

export function shrLimbs(limbs: Uint32Array, shift: number): LimbShift {
  requireWidth(limbs, 'SHR operand');
  if (!Number.isInteger(shift) || shift < 0 || shift >= LIMB_BITS * LIMBS_PER_VALUE) {
    throw new WideError(`SHR by ${shift} is outside the register`);
  }
  const t = tally();
  const limbOffset = Math.floor(shift / LIMB_BITS);
  const bitOffset = shift % LIMB_BITS;
  const out = new Uint32Array(LIMBS_PER_VALUE);
  for (let i = 0; i < LIMBS_PER_VALUE; i += 1) {
    const source = i + limbOffset;
    t.shift32 += 1;
    if (source >= LIMBS_PER_VALUE) {
      out[i] = 0;
    } else if (bitOffset === 0) {
      out[i] = limbs[source]!;
    } else {
      const low = limbs[source]! >>> bitOffset;
      const high =
        source + 1 < LIMBS_PER_VALUE ? (limbs[source + 1]! << (LIMB_BITS - bitOffset)) >>> 0 : 0;
      out[i] = (low | high) >>> 0;
    }
  }
  return { limbs: out, metrics: finish(t) };
}

/* -------------------------------------------------------------------------- */
/* MUL_WIDE                                                                    */
/* -------------------------------------------------------------------------- */

interface HalfProduct {
  readonly lo: number;
  readonly hi: number;
}

/**
 * 32×32→64, from 16-bit halves — the algorithm the shader runs, because WGSL
 * has no u64 to lean on.
 *
 *     a·b = aLo·bLo + (aLo·bHi + aHi·bLo)·2^16 + aHi·bHi·2^32
 *
 * Each half product is at most (2^16 − 1)², which fits a u32 exactly. The two
 * middle terms can overflow their sum, and that wrapped 2^32, scaled by the
 * 2^16 the middle column carries, lands at 2^48 — bit 16 of the high word.
 */
function mul32(a: number, b: number, t: Tally): HalfProduct {
  const aLo = a & 0xffff;
  const aHi = a >>> 16;
  const bLo = b & 0xffff;
  const bHi = b >>> 16;
  const low = aLo * bLo;
  const mid1 = aLo * bHi;
  const mid2 = aHi * bLo;
  const high = aHi * bHi;
  t.mul16 += 4;

  const midSum = (mid1 + mid2) >>> 0;
  const midWrap = midSum < mid1 ? 1 : 0;
  const lo = (low + ((midSum << 16) >>> 0)) >>> 0;
  const loCarry = lo < low ? 1 : 0;
  // The true product is below 2^64, so this sum is below 2^32 and cannot wrap;
  // the additions are safe in u32 as well as here.
  const hi = (high + (midSum >>> 16) + (midWrap << 16) + loCarry) >>> 0;
  t.add32 += 4;
  t.compare32 += 2;
  return { lo, hi };
}

export interface LimbProduct {
  /** 64 limbs: 1024 × 1024 → 2048, nothing dropped (§7). */
  readonly limbs: Uint32Array;
  readonly metrics: LimbMetrics;
}

export function mulLimbs(a: Uint32Array, b: Uint32Array): LimbProduct {
  requireWidth(a, 'MUL_WIDE left operand');
  requireWidth(b, 'MUL_WIDE right operand');
  const t = tally();
  const out = new Uint32Array(PRODUCT_LIMBS);
  for (let i = 0; i < LIMBS_PER_VALUE; i += 1) {
    let carry = 0;
    for (let j = 0; j < LIMBS_PER_VALUE; j += 1) {
      const { lo, hi } = mul32(a[i]!, b[j]!, t);
      // out[i+j] + lo + carry, u32 at every step. The running carry fits a
      // u32 because the whole term does: u32 + u32×u32 + u32 ≤ 2^64 − 1, the
      // identity every schoolbook multiplier stands on.
      const sum1 = (out[i + j]! + lo) >>> 0;
      const c1 = sum1 < lo ? 1 : 0;
      const sum2 = (sum1 + carry) >>> 0;
      const c2 = sum2 < sum1 ? 1 : 0;
      out[i + j] = sum2;
      carry = (hi + c1 + c2) >>> 0;
      t.add32 += 4;
      t.compare32 += 2;
    }
    // Row i touches limbs i .. i+31, so i+32 is untouched until now and the
    // assignment cannot lose an earlier carry.
    out[i + LIMBS_PER_VALUE] = carry;
  }
  return { limbs: out, metrics: finish(t) };
}

/* -------------------------------------------------------------------------- */
/* DIV_REM                                                                     */
/* -------------------------------------------------------------------------- */

export interface LimbDivision {
  readonly quotient: Uint32Array;
  readonly remainder: Uint32Array;
  readonly metrics: LimbMetrics;
}

/**
 * §10's restoring loop at limb granularity.
 *
 * The remainder register is the same 32 limbs as the operands — a theorem, not
 * an economy: after k bits of dividend, R ≤ 2^k − 1, so no intermediate ever
 * needs a 33rd limb. The Python prototype carried one "to be safe" and
 * mutation testing proved it could never be used. The throw below keeps that
 * proof live: if the shift ever emits a carry, the theorem is wrong, and that
 * should be a loud day.
 */
export function divRemLimbs(a: Uint32Array, b: Uint32Array): LimbDivision {
  requireWidth(a, 'DIV_REM dividend');
  requireWidth(b, 'DIV_REM divisor');
  const t = tally();
  const { bitLength, metrics: lengthMetrics } = bitLengthLimbs(b);
  if (bitLength === 0) {
    throw new WideError('DIV_REM by zero has no quotient and no remainder');
  }
  t.compare32 += lengthMetrics.compare32;

  const remainder = new Uint32Array(LIMBS_PER_VALUE);
  const quotient = new Uint32Array(LIMBS_PER_VALUE);
  const top = bitLengthLimbs(a);
  t.compare32 += top.metrics.compare32;

  for (let index = top.bitLength - 1; index >= 0; index -= 1) {
    // remainder = (remainder << 1) | bit(index)
    let carry = (a[Math.floor(index / LIMB_BITS)]! >>> (index % LIMB_BITS)) & 1;
    for (let i = 0; i < LIMBS_PER_VALUE; i += 1) {
      const shifted = ((remainder[i]! << 1) >>> 0) | carry;
      carry = remainder[i]! >>> (LIMB_BITS - 1);
      remainder[i] = shifted;
      t.shift32 += 1;
    }
    if (carry !== 0) {
      throw new WideError('DIV_REM invariant failed: the remainder outgrew the register');
    }

    // remainder >= divisor, compared from the top limb down.
    let fits = true;
    for (let i = LIMBS_PER_VALUE - 1; i >= 0; i -= 1) {
      t.compare32 += 1;
      if (remainder[i] !== b[i]) {
        fits = remainder[i]! > b[i]!;
        break;
      }
    }
    if (fits) {
      const difference = subLimbs(remainder, b);
      if (difference.borrowOut) {
        throw new WideError('DIV_REM subtracted more than it held, which the comparison forbids');
      }
      remainder.set(difference.limbs);
      t.add32 += difference.metrics.add32;
      t.compare32 += difference.metrics.compare32;
      quotient[Math.floor(index / LIMB_BITS)] =
        (quotient[Math.floor(index / LIMB_BITS)]! | (1 << (index % LIMB_BITS))) >>> 0;
    }
  }
  return { quotient, remainder, metrics: finish(t) };
}
