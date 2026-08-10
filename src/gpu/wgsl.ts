/**
 * The WGSL limb kernels, §18.
 *
 * Each kernel textually mirrors its twin in `core/limbs/limbs.ts` — same carry
 * idiom, same 16-bit-half multiply, same no-extra-limb DIV_REM — because the
 * point of the CPU machine was to fix these algorithms where they could be
 * debugged. A shader that "improved" on the CPU kernel would no longer be
 * checked by it.
 *
 * Facts of the dialect that shaped these, worth keeping visible:
 *
 *  - WGSL has no 64-bit integers, so 32×32→64 is `mul32` from 16-bit halves.
 *  - u32 addition wraps silently; carries are detected by comparison, and the
 *    prototype proved the two carry tests can never both fire.
 *  - A shift amount is masked to its low five bits, so `x >> (32u - 0u)` is
 *    `x`, silently — the limb-aligned case must branch, not shift.
 *  - `countLeadingZeros` is `Math.clz32` by another name.
 *
 * One workgroup, one invocation per operation: §17's "one workgroup per wide
 * scalar", with the lanes-cooperating organizations left for later. A serial
 * shader is not fast, but fast was never the claim under test — bit-for-bit
 * agreement is (§19).
 */

/** Shared preamble: the register width and the 32×32→64 primitive. */
const COMMON = /* wgsl */ `
const LIMBS: u32 = 32u;

// 32×32→64 from 16-bit halves. Both result words, low then high.
fn mul32(a: u32, b: u32) -> vec2<u32> {
  let a_lo = a & 0xffffu;
  let a_hi = a >> 16u;
  let b_lo = b & 0xffffu;
  let b_hi = b >> 16u;
  let low = a_lo * b_lo;
  let mid1 = a_lo * b_hi;
  let mid2 = a_hi * b_lo;
  let high = a_hi * b_hi;

  let mid_sum = mid1 + mid2;
  let mid_wrap = select(0u, 1u, mid_sum < mid1);
  let lo = low + (mid_sum << 16u);
  let lo_carry = select(0u, 1u, lo < low);
  let hi = high + (mid_sum >> 16u) + (mid_wrap << 16u) + lo_carry;
  return vec2<u32>(lo, hi);
}
`;

/** ADD: out[0..31] is the wrapped sum, out[32] the carry out of the register. */
export const ADD_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(1) var<storage, read> b: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 33>;

@compute @workgroup_size(1)
fn main() {
  var carry: u32 = 0u;
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    let sum1 = a[i] + b[i];
    let c1 = select(0u, 1u, sum1 < a[i]);
    let sum2 = sum1 + carry;
    let c2 = select(0u, 1u, sum2 < sum1);
    out[i] = sum2;
    carry = c1 + c2;
  }
  out[32] = carry;
}
`;

/** SUB: out[0..31] wraps mod 2^1024, out[32] is the borrow. */
export const SUB_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(1) var<storage, read> b: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 33>;

@compute @workgroup_size(1)
fn main() {
  var borrow: u32 = 0u;
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    let diff1 = a[i] - b[i];
    let b1 = select(0u, 1u, a[i] < b[i]);
    let diff2 = diff1 - borrow;
    let b2 = select(0u, 1u, diff1 < borrow);
    out[i] = diff2;
    borrow = b1 + b2;
  }
  out[32] = borrow;
}
`;

/** BITLEN: out[0] is the bit length of a. */
export const BITLEN_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 1>;

@compute @workgroup_size(1)
fn main() {
  out[0] = 0u;
  for (var i: i32 = 31; i >= 0; i = i - 1) {
    if (a[i] != 0u) {
      out[0] = u32(i) * 32u + (32u - countLeadingZeros(a[i]));
      return;
    }
  }
}
`;

/**
 * SHL and SHR take the shift in a uniform. The limb-aligned case branches:
 * WGSL masks shift amounts, so shifting by 32 is shifting by zero, silently.
 */
export const SHL_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 32>;
@group(0) @binding(3) var<uniform> shift: u32;

@compute @workgroup_size(1)
fn main() {
  let limb_offset = shift / 32u;
  let bit_offset = shift % 32u;
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    if (i < limb_offset) {
      out[i] = 0u;
    } else if (bit_offset == 0u) {
      out[i] = a[i - limb_offset];
    } else {
      let source = i - limb_offset;
      let low = a[source] << bit_offset;
      var high: u32 = 0u;
      if (source > 0u) {
        high = a[source - 1u] >> (32u - bit_offset);
      }
      out[i] = low | high;
    }
  }
}
`;

export const SHR_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 32>;
@group(0) @binding(3) var<uniform> shift: u32;

@compute @workgroup_size(1)
fn main() {
  let limb_offset = shift / 32u;
  let bit_offset = shift % 32u;
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    let source = i + limb_offset;
    if (source >= LIMBS) {
      out[i] = 0u;
    } else if (bit_offset == 0u) {
      out[i] = a[source];
    } else {
      let low = a[source] >> bit_offset;
      var high: u32 = 0u;
      if (source + 1u < LIMBS) {
        high = a[source + 1u] << (32u - bit_offset);
      }
      out[i] = low | high;
    }
  }
}
`;

/** MUL_WIDE: out[0..63] is the full 2048-bit product, nothing dropped (§7). */
export const MUL_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(1) var<storage, read> b: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 64>;

@compute @workgroup_size(1)
fn main() {
  for (var i: u32 = 0u; i < 64u; i = i + 1u) {
    out[i] = 0u;
  }
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    var carry: u32 = 0u;
    for (var j: u32 = 0u; j < LIMBS; j = j + 1u) {
      let product = mul32(a[i], b[j]);
      // u32 + u32×u32 + u32 ≤ 2^64 − 1, so the running carry fits a u32.
      let sum1 = out[i + j] + product.x;
      let c1 = select(0u, 1u, sum1 < product.x);
      let sum2 = sum1 + carry;
      let c2 = select(0u, 1u, sum2 < sum1);
      out[i + j] = sum2;
      carry = product.y + c1 + c2;
    }
    out[i + LIMBS] = carry;
  }
}
`;

/**
 * DIV_REM: restoring binary division, §10's loop. out[0..31] quotient,
 * out[32..63] remainder, out[64] the invariant flag — the remainder register
 * has no 33rd limb because R ≤ 2^k − 1 after k bits (proved in the prototype),
 * and a shader cannot throw, so the theorem failing sets a flag the harness
 * refuses to ignore.
 */
export const DIVREM_WGSL = /* wgsl */ `${COMMON}
@group(0) @binding(0) var<storage, read> a: array<u32, 32>;
@group(0) @binding(1) var<storage, read> b: array<u32, 32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32, 65>;

@compute @workgroup_size(1)
fn main() {
  var remainder: array<u32, 32>;
  for (var i: u32 = 0u; i < 64u; i = i + 1u) {
    out[i] = 0u;
  }
  out[64] = 0u;
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    remainder[i] = 0u;
  }

  // Bit length of the dividend, inline — storage-pointer function parameters
  // are newer WGSL than this file needs to assume.
  var top: u32 = 0u;
  for (var i: i32 = 31; i >= 0; i = i - 1) {
    if (a[i] != 0u) {
      top = u32(i) * 32u + (32u - countLeadingZeros(a[i]));
      break;
    }
  }
  for (var step: u32 = 0u; step < top; step = step + 1u) {
    let index = top - 1u - step;
    // remainder = (remainder << 1) | bit(index)
    var carry: u32 = (a[index / 32u] >> (index % 32u)) & 1u;
    for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
      let shifted = (remainder[i] << 1u) | carry;
      carry = remainder[i] >> 31u;
      remainder[i] = shifted;
    }
    if (carry != 0u) {
      out[64] = 1u; // the theorem failed; the harness must refuse this result
      return;
    }

    // remainder >= divisor, compared from the top limb down.
    var fits = true;
    for (var i: i32 = 31; i >= 0; i = i - 1) {
      if (remainder[i] != b[i]) {
        fits = remainder[i] > b[i];
        break;
      }
    }
    if (fits) {
      var borrow: u32 = 0u;
      for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
        let diff1 = remainder[i] - b[i];
        let b1 = select(0u, 1u, remainder[i] < b[i]);
        let diff2 = diff1 - borrow;
        let b2 = select(0u, 1u, diff1 < borrow);
        remainder[i] = diff2;
        borrow = b1 + b2;
      }
      out[index / 32u] = out[index / 32u] | (1u << (index % 32u));
    }
  }
  for (var i: u32 = 0u; i < LIMBS; i = i + 1u) {
    out[32u + i] = remainder[i];
  }
}
`;
