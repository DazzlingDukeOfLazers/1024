# -*- coding: utf-8 -*-
"""An independent oracle for the exact numerical core.

The TypeScript core is well tested, but every one of those tests was written by
the same author as the code, at the same time, with the same idea of what the
answer should be. A test suite of that shape cannot find a misconception, only a
slip. This is a second implementation with different bugs.

Python earns the job in a narrow band and no wider:

  * `fractions.Fraction` is exact rational arithmetic, implemented by other
    people, so it checks `Rational` against something that is not itself;
  * `float(Fraction)` is correctly rounded nearest-even, which is exactly the
    rule `encodeRational` implements by hand rather than delegating;
  * `Fraction(some_float)` is the exact value of a double, which is what
    `exactValue` claims to produce;
  * `math.nextafter` walks real neighbours, which is what `successor` and
    `predecessor` claim to do.

The finite machines are here too, which took a second look. Python's unbounded
ints do hide finiteness — but only from an oracle that never asks. Asked out
loud, they are the right tool: they quantize onto a Q128.128 or 256-bit Planck
grid exactly, and then report whether the answer fits the width, which is a plain
integer comparison. `Fraction` is still doing the part that is hard to get right.

The overflow *policy* — checked, wrapping, saturating — is not offered here,
because that is this project's design rather than a shared rule, and a second
implementation of it by the same author is not evidence of anything.

Output is committed as `fixtures/oracle.json` so the comparison runs in CI with
no Python installed. Regenerate deliberately:

    python tools/oracle.py

and read the diff — a change here means one of the two implementations moved.
"""

import hashlib
import io
import json
import math
import os
import random
import struct
import decimal
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'fixtures', 'oracle.json')

# Fixed, so the fixture is reproducible and a diff means a real change.
SEED = 1024


def frac(value):
    """A Fraction as the two decimal strings the TS side reads as BigInt."""
    return [str(value.numerator), str(value.denominator)]


def bits_of(x):
    """The 64 bits of a double, as an unsigned integer."""
    return struct.unpack('>Q', struct.pack('>d', x))[0]


def curated():
    """The values that have caused trouble, here and historically."""
    return [
        Fraction(0),
        Fraction(1),
        Fraction(-1),
        Fraction(1, 10),  # no binary representation
        Fraction(2, 10),
        Fraction(3, 10),
        Fraction(1, 3),  # no decimal representation
        Fraction(2, 3),
        Fraction(-1, 3),
        Fraction(1, 7),
        Fraction(75, 10) / 10**6,  # a red blood cell
        Fraction(10) ** 20,  # the far origin
        Fraction(10) ** 20 + Fraction(1, 1000),
        Fraction(1, 1000),
        Fraction(2) ** 53,  # the edge of exact integers
        Fraction(2) ** 53 + 1,
        Fraction(2) ** 53 + 2,
        Fraction(2) ** -1022,  # smallest normal
        Fraction(2) ** -1074,  # smallest subnormal
        Fraction(2) ** -1075,  # rounds to zero, or to the smallest subnormal
        Fraction(3) * Fraction(2) ** -1075,
        Fraction(10) ** -310,  # deep subnormal
        Fraction(2) ** 1023,
        (Fraction(2) ** 53 - 1) * Fraction(2) ** 971,  # largest finite double
        Fraction(2) ** 1024,  # overflows
        Fraction(10) ** 400,  # overflows, and has no double at all
        -(Fraction(10) ** 400),
        Fraction(1616255, 10**41),  # the Planck length
        Fraction(149597870700),  # the astronomical unit
        Fraction(9460730472580800),  # the light-year
    ]


def ties(count, rng):
    """Values sitting exactly halfway between two doubles.

    Ties-to-even is the rule most easily got wrong, and a tie is the only input
    that can tell a correct implementation from one that rounds half away from
    zero. Both sides must agree on which way each of these falls.
    """
    out = []
    for _ in range(count):
        exponent = rng.randint(-60, 60)
        significand = rng.randrange(1 << 52, 1 << 53)
        # Half an ulp above a representable value.
        base = Fraction(significand) * Fraction(2) ** (exponent - 52)
        half = Fraction(2) ** (exponent - 53)
        out.append(base + half)
        out.append(-(base + half))
    return out


def random_rationals(count, rng):
    out = []
    for _ in range(count):
        numerator = rng.randint(-(10**12), 10**12)
        denominator = rng.randint(1, 10**12)
        scale = rng.randint(-40, 40)
        out.append(Fraction(numerator, denominator) * Fraction(10) ** scale)
    return out


def exact_decimal(value):
    """The full decimal expansion, or None when it repeats forever.

    A fraction terminates in base ten exactly when its reduced denominator has
    no prime factors but two and five.
    """
    denominator = value.denominator
    for prime in (2, 5):
        while denominator % prime == 0:
            denominator //= prime
    if denominator != 1:
        return None

    negative = value < 0
    magnitude = -value if negative else value
    digits = 0
    scaled = magnitude.denominator
    while scaled % 2 == 0:
        scaled //= 2
        digits += 1
    fives = 0
    scaled = magnitude.denominator
    while scaled % 5 == 0:
        scaled //= 5
        fives += 1
    places = max(digits, fives)

    numerator = magnitude.numerator * 10**places // magnitude.denominator
    text = str(numerator)
    if places > 0:
        text = text.rjust(places + 1, '0')
        text = text[:-places] + '.' + text[-places:]
    return ('-' if negative and numerator != 0 else '') + text


def order_of_magnitude_10(value):
    """floor(log10(|value|)), by exact integer comparison rather than by log."""
    if value == 0:
        return None
    magnitude = abs(value)
    exponent = len(str(magnitude.numerator)) - len(str(magnitude.denominator))
    # Correct the estimate, which can be out by one either way.
    while Fraction(10) ** exponent > magnitude:
        exponent -= 1
    while Fraction(10) ** (exponent + 1) <= magnitude:
        exponent += 1
    return exponent


def order_of_magnitude_2(value):
    if value == 0:
        return None
    magnitude = abs(value)
    exponent = magnitude.numerator.bit_length() - magnitude.denominator.bit_length()
    while Fraction(2) ** exponent > magnitude:
        exponent -= 1
    while Fraction(2) ** (exponent + 1) <= magnitude:
        exponent += 1
    return exponent


# The largest finite double, and the point above which rounding reaches past it.
MAX_FINITE = (Fraction(2) ** 53 - 1) * Fraction(2) ** 971
# Halfway between MAX_FINITE and 2^1024. IEEE 754 rounds a tie to the even
# significand, which out here is 2^1024, so the midpoint itself overflows.
OVERFLOW_AT = Fraction(2) ** 1024 - Fraction(2) ** 970


def encode_binary64(value):
    """What a correctly rounding encoder must produce for this exact value.

    Python's own `float(Fraction)` raises `OverflowError` rather than returning
    infinity for values past the top of the range, so the oracle applies the
    IEEE rule itself rather than borrowing this one. Worth noting as a limit of
    the oracle: on overflow it is asserting a rule rather than a second
    implementation of one.
    """
    if abs(value) >= OVERFLOW_AT:
        return {'kind': 'infinite', 'sign': 1 if value > 0 else -1}

    stored = float(value)  # correctly rounded, nearest-even
    if math.isinf(stored):
        return {'kind': 'infinite', 'sign': 1 if stored > 0 else -1}
    if stored == 0.0:
        return {
            'kind': 'zero',
            'negativeZero': math.copysign(1.0, stored) < 0,
            'underflowed': value != 0,
        }
    return {
        'kind': 'finite',
        'bits': str(bits_of(stored)),
        'exact': frac(Fraction(stored)),
        'quantizationError': frac(Fraction(stored) - value),
    }


def neighbours(value):
    """Real neighbours of a double, and the gaps to them."""
    if abs(value) >= OVERFLOW_AT:
        return None
    stored = float(value)
    if not math.isfinite(stored) or stored == 0.0:
        return None
    below = math.nextafter(stored, -math.inf)
    above = math.nextafter(stored, math.inf)
    entry = {'value': frac(Fraction(stored))}
    if math.isfinite(below):
        entry['gapBelow'] = frac(Fraction(stored) - Fraction(below))
    if math.isfinite(above):
        entry['gapAbove'] = frac(Fraction(above) - Fraction(stored))
    return entry


def round_nearest_even(value):
    """The rounding rule every machine here uses, in exact integer arithmetic."""
    floor = value.numerator // value.denominator
    remainder = value - floor
    if remainder < Fraction(1, 2):
        return floor
    if remainder > Fraction(1, 2):
        return floor + 1
    return floor if floor % 2 == 0 else floor + 1


# Metres per machine unit for the four Q128.128 presets, and the CODATA 2018
# Planck length the 256-bit tick register counts in.
Q128_BASE_UNITS = {
    'mm': Fraction(10) ** -3,
    'm': Fraction(1),
    'km': Fraction(10) ** 3,
    'Mm': Fraction(10) ** 6,
}
PLANCK_LENGTH = Fraction(1616255, 10**41)


def signed_fits(raw, width):
    return -(2 ** (width - 1)) <= raw < 2 ** (width - 1)


def fixed_point(value, base_unit, fraction_bits, width_bits):
    """Quantize an exact value onto a finite fixed-point grid.

    The unbounded integers are the point rather than the problem: they let the
    oracle compute the quantization exactly and then ask, explicitly, whether the
    answer fits the width. A check that never asked would be worse than none.
    """
    machine_units = value / base_unit
    raw = round_nearest_even(machine_units * 2**fraction_bits)
    entry = {'raw': str(raw), 'fits': signed_fits(raw, width_bits)}
    if entry['fits']:
        decoded = Fraction(raw, 2**fraction_bits) * base_unit
        entry['decoded'] = frac(decoded)
        entry['quantizationError'] = frac(decoded - value)
    return entry


def wide_cases(rng):
    """Operands for MUL_WIDE, chosen from the list in the architecture doc §19.

    All-zero, all-one, single-bit sparse, leading-zero-heavy, dense random, and
    the long carry chains that come of multiplying all-ones by all-ones.
    """
    cases = [
        0,
        1,
        2,
        (1 << 64) - 1,
        1 << 64,
        (1 << 128) - 1,
        (1 << 512) - 1,
        (1 << 1024) - 1,  # all ones: the longest carry chain available
        (1 << 700) + (1 << 12),  # sparse
        (1 << 1023),  # leading-zero-heavy the other way
        (1 << 1023) + 1,
    ]
    for _ in range(24):
        cases.append(rng.getrandbits(rng.randint(1, 1024)))
    return cases


# ---------------------------------------------------------------------------
# §17–§18: the u32-limb model. One 1024-bit value is 32 × u32 limbs, limb 0
# least significant — the layout `array<u32, 32>` will use in WGSL.
#
# The kernels below are limb-serial on purpose: they are the prototype of the
# arithmetic the CPU limb machine and the compute shaders will implement, so
# they may only combine limbs the way u32 hardware can — 32×32→64 products,
# single-bit carries and borrows — and every result is asserted against
# Python's native integers before it is allowed into the fixture. A prototype
# that is its own correctness reference is exactly what §19 forbids.
#
# The model is unsigned at kernel level, like `mulWide`'s digit arrays: sign
# belongs to the boundary, not the limbs. §19's "min/max signed" appears here
# as the 2^1023 bit patterns. Narrowing is §8's own operation family and is
# not a limb kernel.

LIMB_BITS = 32
LIMB_MASK = (1 << LIMB_BITS) - 1
LIMBS = 32  # 1024 bits


def to_limbs(value, count=LIMBS):
    assert 0 <= value < 1 << (LIMB_BITS * count)
    return [(value >> (LIMB_BITS * i)) & LIMB_MASK for i in range(count)]


def from_limbs(limbs):
    return sum(limb << (LIMB_BITS * i) for i, limb in enumerate(limbs))


def limb_add(a, b):
    """ADD, computed two ways at once and required to agree.

    The obvious form keeps a 33-bit intermediate. The WGSL form cannot — u32
    addition wraps silently — so it detects the carry by comparison: a wrapped
    sum is smaller than either operand. Prototyping both here is the point of
    doing this in Python first: a wrong carry idiom should die in an assert,
    not in a shader.
    """
    out = []
    carry = 0
    wgsl_out = []
    wgsl_carry = 0
    for i in range(LIMBS):
        total = a[i] + b[i] + carry
        out.append(total & LIMB_MASK)
        carry = total >> LIMB_BITS

        sum1 = (a[i] + b[i]) & LIMB_MASK
        c1 = 1 if sum1 < a[i] else 0
        sum2 = (sum1 + wgsl_carry) & LIMB_MASK
        c2 = 1 if sum2 < sum1 else 0
        # Both carries cannot fire on one limb: if the first addition wrapped,
        # its result is at most 2^32 − 2, and adding one cannot wrap again.
        assert c1 + c2 <= 1
        wgsl_out.append(sum2)
        wgsl_carry = c1 + c2
    assert out == wgsl_out and carry == wgsl_carry
    return out, carry


def limb_sub(a, b):
    """SUB, wrapping mod 2^1024, with the borrow reported rather than hidden."""
    out = []
    borrow = 0
    for i in range(len(a)):
        diff = a[i] - b[i] - borrow
        borrow = 1 if diff < 0 else 0
        out.append(diff & LIMB_MASK)
    return out, borrow


def limb_bitlen(limbs):
    """BITLEN: index of the highest non-zero limb, plus that limb's own length."""
    for i in range(len(limbs) - 1, -1, -1):
        if limbs[i] != 0:
            return LIMB_BITS * i + limbs[i].bit_length()
    return 0


def limb_shl(limbs, shift):
    """SHL within the register. The WGSL hazard this encodes: shifting a u32 by
    32 is not a defined way to get zero, so the limb-aligned case branches
    instead of shifting by `LIMB_BITS - 0`.
    """
    limb_offset, bit_offset = divmod(shift, LIMB_BITS)
    out = []
    for i in range(LIMBS):
        source = i - limb_offset
        if source < 0:
            out.append(0)
        elif bit_offset == 0:
            out.append(limbs[source])
        else:
            low = (limbs[source] << bit_offset) & LIMB_MASK
            high = limbs[source - 1] >> (LIMB_BITS - bit_offset) if source > 0 else 0
            out.append(low | high)
    return out


def limb_shr(limbs, shift):
    limb_offset, bit_offset = divmod(shift, LIMB_BITS)
    out = []
    for i in range(LIMBS):
        source = i + limb_offset
        if source >= LIMBS:
            out.append(0)
        elif bit_offset == 0:
            out.append(limbs[source])
        else:
            low = limbs[source] >> bit_offset
            high = (
                (limbs[source + 1] << (LIMB_BITS - bit_offset)) & LIMB_MASK
                if source + 1 < LIMBS
                else 0
            )
            out.append(low | high)
    return out


def limb_mul(a, b):
    """MUL_WIDE: 1024 × 1024 → 2048, schoolbook over 32×32→64 partial products.

    The inner accumulation relies on the identity that keeps u32 multipliers
    honest: u32×u32 + u32 + u32 ≤ 2^64 − 1, so the running term never outgrows
    the double-width intermediate the hardware actually has.
    """
    out = [0] * (2 * LIMBS)
    for i in range(LIMBS):
        carry = 0
        for j in range(LIMBS):
            term = out[i + j] + a[i] * b[j] + carry
            assert term < 1 << 64
            out[i + j] = term & LIMB_MASK
            carry = term >> LIMB_BITS
        out[i + LIMBS] = carry
    return out


def limb_divrem(a, b):
    """DIV_REM: §10's restoring loop at limb granularity.

    The remainder register is the same 32 limbs as the operands, and that is a
    theorem rather than an economy: after k bits of the dividend have been
    consumed, R ≤ 2^k − 1 — the shifted value is 2R + bit ≤ 2^k − 1, and the
    subtraction only ever lowers it — so with at most 1024 steps no
    intermediate ever needs a 33rd limb. The first draft of this function
    carried one anyway, "to be safe", and mutation testing proved it could
    never be used: removing it changed nothing any fixture could see. The
    assert on the shift's outgoing carry is that proof kept live, and the WGSL
    kernel gets to be one limb smaller because of it.
    """
    assert from_limbs(b) != 0
    remainder = [0] * LIMBS
    quotient = [0] * LIMBS
    for index in range(limb_bitlen(a) - 1, -1, -1):
        # remainder = (remainder << 1) | bit(index)
        carry = (a[index // LIMB_BITS] >> (index % LIMB_BITS)) & 1
        for i in range(LIMBS):
            shifted = ((remainder[i] << 1) & LIMB_MASK) | carry
            carry = remainder[i] >> (LIMB_BITS - 1)
            remainder[i] = shifted
        assert carry == 0  # the R ≤ 2^k − 1 invariant, kept loud
        # compare remainder >= divisor, from the top limb down
        fits = True
        for i in range(LIMBS - 1, -1, -1):
            if remainder[i] != b[i]:
                fits = remainder[i] > b[i]
                break
        if fits:
            remainder, borrow = limb_sub(remainder, b)
            assert borrow == 0
            quotient[index // LIMB_BITS] |= 1 << (index % LIMB_BITS)
    return quotient, remainder


def limb_operand_cases(rng):
    """§19's stress list, as unsigned 1024-bit values."""
    top = (1 << 1024) - 1
    cases = [
        0,
        1,
        2,
        LIMB_MASK,  # one full limb
        LIMB_MASK + 1,  # the first inter-limb boundary
        (1 << 64) - 1,
        top,  # all ones: the longest carry chain there is
        top - 1,
        1 << 512,
        (1 << 512) - 1,
        (1 << 700) + (1 << 12),  # sparse
        1 << 1023,  # the signed-min bit pattern
        (1 << 1023) + 1,
        (1 << 96) - (1 << 32),  # leading-zero-heavy, with a hole
    ]
    for _ in range(18):
        cases.append(rng.getrandbits(rng.randint(1, 1024)))  # dense, seeded
    for _ in range(6):
        cases.append(1 << rng.randint(0, 1023))  # single-bit sparse
    return cases


def limb_section(rng):
    """Generate the limb fixtures, asserting every kernel against native ints."""
    cases = limb_operand_cases(rng)
    top = (1 << 1024) - 1

    encoding = []
    for value in [0, 1, LIMB_MASK, LIMB_MASK + 1, top, 1 << 1023, (1 << 700) + (1 << 12)]:
        encoding.append({'value': str(value), 'limbs': to_limbs(value)})

    add = []
    add_pairs = [(top, 1), (top, top), (1 << 1023, 1 << 1023), (0, 0)]
    add_pairs += [(rng.choice(cases), rng.choice(cases)) for _ in range(36)]
    for a, b in add_pairs:
        limbs, carry = limb_add(to_limbs(a), to_limbs(b))
        expected = a + b
        assert from_limbs(limbs) == expected & top
        assert carry == expected >> 1024
        add.append({'a': str(a), 'b': str(b), 'sum': str(expected & top), 'carryOut': carry == 1})

    sub = []
    sub_pairs = [(0, 1), (0, top), (1 << 1023, (1 << 1023) + 1), (top, top)]
    sub_pairs += [(rng.choice(cases), rng.choice(cases)) for _ in range(36)]
    for a, b in sub_pairs:
        limbs, borrow = limb_sub(to_limbs(a), to_limbs(b))
        expected = (a - b) % (1 << 1024)
        assert from_limbs(limbs) == expected
        assert (borrow == 1) == (a < b)
        sub.append(
            {'a': str(a), 'b': str(b), 'difference': str(expected), 'borrowOut': borrow == 1}
        )

    bitlen = []
    for value in cases[:20]:
        measured = limb_bitlen(to_limbs(value))
        assert measured == value.bit_length()
        bitlen.append({'value': str(value), 'bitLength': measured})

    shl = []
    shr = []
    shifts = [0, 1, 31, 32, 33, 63, 64, 511, 512, 1023]
    shifts += [rng.randint(2, 1022) for _ in range(8)]
    for shift in shifts:
        value = rng.choice(cases)
        left = limb_shl(to_limbs(value), shift)
        assert from_limbs(left) == (value << shift) & top
        # What fell off the top is oracle data computed natively, not a kernel
        # output — the register kernel only holds the register.
        shl.append(
            {
                'value': str(value),
                'shift': shift,
                'result': str((value << shift) & top),
                'lost': str(value >> (1024 - shift) if shift > 0 else 0),
            }
        )
        right = limb_shr(to_limbs(value), shift)
        assert from_limbs(right) == value >> shift
        shr.append(
            {
                'value': str(value),
                'shift': shift,
                'result': str(value >> shift),
                'lost': str(value & ((1 << shift) - 1) if shift > 0 else 0),
            }
        )

    mul_wide = []
    mul_pairs = [(top, top), (top, 1), (1 << 1023, 2), (0, top)]
    mul_pairs += [(rng.choice(cases), rng.choice(cases)) for _ in range(26)]
    for a, b in mul_pairs:
        limbs = limb_mul(to_limbs(a), to_limbs(b))
        assert from_limbs(limbs) == a * b
        mul_wide.append({'a': str(a), 'b': str(b), 'product': str(a * b)})

    div_rem = []
    divisors = [d for d in cases if d != 0]
    div_pairs = [(top, 1), (top, top), (0, 7), (1, top)]
    div_pairs += [(rng.choice(cases), rng.choice(divisors)) for _ in range(22)]
    # Exact divisions on purpose, so `remainder == 0` is a covered path.
    for divisor in [7, (1 << 64) - 1, 1 << 500]:
        div_pairs.append(((divisor * 12345) % (1 << 1024), divisor))
    for a, b in div_pairs:
        quotient, remainder = limb_divrem(to_limbs(a), to_limbs(b))
        assert from_limbs(quotient) == a // b
        assert from_limbs(remainder) == a % b
        div_rem.append(
            {
                'dividend': str(a),
                'divisor': str(b),
                'quotient': str(a // b),
                'remainder': str(a % b),
            }
        )

    # Anti-vacuity: a fixture set in which no addition carried, no subtraction
    # borrowed, no shift lost a bit and no division was exact would pass every
    # test above while exercising none of the interesting paths.
    assert any(entry['carryOut'] for entry in add)
    assert any(not entry['carryOut'] for entry in add)
    assert any(entry['borrowOut'] for entry in sub)
    assert any(entry['lost'] != '0' for entry in shl)
    assert any(entry['lost'] != '0' for entry in shr)
    assert any(entry['remainder'] == '0' for entry in div_rem)
    assert any(entry['remainder'] != '0' for entry in div_rem)
    assert any(entry['bitLength'] == 1024 for entry in bitlen)

    return {
        'limbBits': LIMB_BITS,
        'limbsPerValue': LIMBS,
        'layout': 'limb 0 is least significant',
        'encoding': encoding,
        'add': add,
        'sub': sub,
        'bitlen': bitlen,
        'shl': shl,
        'shr': shr,
        'mulWide': mul_wide,
        'divRem': div_rem,
    }


# ---------------------------------------------------------------------------
# Rotation: sin and cos of dyadic multiples of pi
# ---------------------------------------------------------------------------
#
# The two-track rotation experiment needs a reference the TypeScript side cannot
# produce, and this is the first place in this file where the honest answer is
# not exact. sin and cos of a rational multiple of pi are irrational except in
# the handful of cases Niven's theorem allows, so the reference here is a
# *declared* high-precision value: computed to more digits than any machine
# under test can hold, and shipped with the digit count so nothing below it is
# mistaken for measured.
#
# `decimal` rather than `math`: doubles have 17 digits and Q128.128 has 38, so a
# float reference could not measure the fixed-point machine's error at all. The
# series below are the textbook Taylor expansions, summed until a term falls
# below the working precision. That is a second implementation in the sense this
# file exists for — the TypeScript side never computes a sine at all, it reads
# these numbers.

ROTATION_DIGITS = 60
# theta = pi / 8, a dyadic multiple of pi. Dyadic matters: an angle register
# scaled by pi with binary fraction bits can hold k/2^n exactly and nothing
# else, so this angle accumulates with no error at all and wraps exactly at
# 16 steps. Its sine and cosine are irrational, which is the price Niven's
# theorem charges for that.
ROTATION_DENOMINATOR = 8
ROTATION_PERIOD = 2 * ROTATION_DENOMINATOR


# k*pi/8 at the quarter turns, where Niven's theorem says the values are
# rational -- and here they are integers.
QUARTER_TURNS = {0: ('1', '0'), 4: ('0', '1'), 8: ('-1', '0'), 12: ('0', '-1')}


def _pi(context):
    """Pi by the Gauss-Legendre-free series from the decimal documentation."""
    context.prec += 2
    three = decimal.Decimal(3)
    lasts, t, s, n, na, d, da = 0, three, 3, 1, 0, 0, 24
    while s != lasts:
        lasts = s
        n, na = n + na, na + 8
        d, da = d + da, da + 32
        t = (t * n) / d
        s += t
    context.prec -= 2
    return +s


def _cos(x, context):
    context.prec += 2
    i, lasts, s, fact, num, sign = 0, 0, 1, 1, 1, 1
    while s != lasts:
        lasts = s
        i += 2
        fact *= i * (i - 1)
        num *= x * x
        sign *= -1
        s += num / fact * sign
    context.prec -= 2
    return +s


def _sin(x, context):
    context.prec += 2
    i, lasts, s, fact, num, sign = 1, 0, x, 1, x, 1
    while s != lasts:
        lasts = s
        i += 2
        fact *= i * (i - 1)
        num *= x * x
        sign *= -1
        s += num / fact * sign
    context.prec -= 2
    return +s


def rotation_section():
    context = decimal.getcontext()
    previous = context.prec
    context.prec = ROTATION_DIGITS + 10
    try:
        pi = _pi(context)
        steps = []
        for k in range(ROTATION_PERIOD):
            angle = pi * k / ROTATION_DENOMINATOR
            quarter = QUARTER_TURNS.get(k % ROTATION_PERIOD)
            if quarter is None:
                cos_text = _round(_cos(angle, context))
                sin_text = _round(_sin(angle, context))
            else:
                # The quarter turns are exact, and saying so is not a shortcut.
                # A truncated Taylor series at an odd multiple of pi/2 returns
                # about 2e-70 for a cosine that is zero, and rounding that to 60
                # significant digits publishes seventy digits of noise as though
                # they were measured. These are the only rational multiples of
                # pi whose sine and cosine are rational at all -- Niven's
                # theorem -- so they are the one place here an exact answer
                # exists, and the series is the wrong instrument for it.
                cos_text, sin_text = quarter
            steps.append(
                {
                    'step': k,
                    # The angle as a multiple of pi, exactly: k/8 is dyadic, so
                    # this one really is a fraction and not an approximation.
                    'anglePi': '%d/%d' % (k, ROTATION_DENOMINATOR),
                    'cos': cos_text,
                    'sin': sin_text,
                    'exact': quarter is not None,
                }
            )
    finally:
        context.prec = previous
    return {
        'digits': ROTATION_DIGITS,
        'denominator': ROTATION_DENOMINATOR,
        'period': ROTATION_PERIOD,
        'note': (
            'sin and cos of k*pi/8 to %d significant digits. Irrational by '
            "Niven's theorem except at the quarter turns, so this is a declared "
            'reference rather than an exact one.' % ROTATION_DIGITS
        ),
        'steps': steps,
    }


def _round(value):
    """Fixed number of significant digits, as a plain decimal string."""
    if value == 0:
        return '0'
    quantized = +decimal.Context(prec=ROTATION_DIGITS).create_decimal(value)
    return format(quantized, 'f')


def main():
    rng = random.Random(SEED)
    values = curated() + ties(60, rng) + random_rationals(240, rng)

    arithmetic = []
    for _ in range(300):
        a = rng.choice(values)
        b = rng.choice(values)
        entry = {
            'a': frac(a),
            'b': frac(b),
            'add': frac(a + b),
            'sub': frac(a - b),
            'mul': frac(a * b),
            'compare': (a > b) - (a < b),
        }
        if b != 0:
            entry['div'] = frac(a / b)
        arithmetic.append(entry)

    magnitudes = []
    decimals = []
    encodings = []
    neighbourhoods = []
    for value in values:
        if value != 0:
            magnitudes.append(
                {
                    'value': frac(value),
                    'log10': order_of_magnitude_10(value),
                    'log2': order_of_magnitude_2(value),
                }
            )
        decimals.append({'value': frac(value), 'exactDecimal': exact_decimal(value)})
        encodings.append({'value': frac(value), 'encoded': encode_binary64(value)})
        near = neighbours(value)
        if near is not None:
            neighbourhoods.append({'value': frac(value), **near})

    # The finite machines. Python's ints are unbounded, so the oracle has to ask
    # the width question out loud — see `fixed_point`. Values are chosen to
    # straddle every boundary that matters: below the LSB, at half an LSB, and
    # past the top of each machine's range.
    machine_values = values + [
        Fraction(2) ** 127,  # inside Q128.128 @ m, outside @ mm
        Fraction(2) ** 128,  # outside @ m
        Fraction(2) ** -129,  # below the @ m LSB
        Fraction(1, 2) * Fraction(2) ** -128,  # exactly half an LSB @ m
        Fraction(3, 2) * Fraction(2) ** -128,  # one and a half: ties the other way
        Fraction(10) ** 40,
        -(Fraction(10) ** 40),
        PLANCK_LENGTH / 2,  # half a tick: a tie on the Planck grid
        PLANCK_LENGTH * Fraction(3, 2),
    ]

    q128 = []
    for label, base in Q128_BASE_UNITS.items():
        for value in machine_values:
            q128.append(
                {
                    'baseUnit': label,
                    'value': frac(value),
                    **fixed_point(value, base, 128, 256),
                }
            )

    planck = [
        {
            'value': frac(value),
            'ticks': str(round_nearest_even(value / PLANCK_LENGTH)),
            'fits': signed_fits(round_nearest_even(value / PLANCK_LENGTH), 256),
            'decoded': frac(round_nearest_even(value / PLANCK_LENGTH) * PLANCK_LENGTH),
        }
        for value in machine_values
    ]

    meter = [
        {'value': frac(value), **fixed_point(value, Fraction(1), 512, 1024)}
        for value in machine_values
    ]

    # §19: every experimental implementation must be checked against a CPU
    # oracle, bit for bit. Python's integers are the oracle for MUL_WIDE, which
    # is the one place unbounded precision is exactly what is wanted.
    operands = wide_cases(rng)
    wide_multiply = []
    for _ in range(160):
        a = rng.choice(operands)
        b = rng.choice(operands)
        sign_a = -1 if rng.random() < 0.25 else 1
        sign_b = -1 if rng.random() < 0.25 else 1
        wide_multiply.append(
            {
                'a': str(sign_a * a),
                'b': str(sign_b * b),
                'product': str(sign_a * a * sign_b * b),
                'productBits': (a * b).bit_length(),
            }
        )

    # §19 again, for DIV_REM. The invariant A × 2^F = Q × B + R is the whole
    # contract, so the oracle supplies both halves and the test checks the
    # identity as well as the values. Python truncates toward zero, which is the
    # convention that keeps the identity true for signed operands.
    wide_divide = []
    divisors = [d for d in operands if d != 0][:12]
    for _ in range(140):
        a = rng.choice(operands)
        b = rng.choice(divisors)
        sign_a = -1 if rng.random() < 0.25 else 1
        sign_b = -1 if rng.random() < 0.25 else 1
        fraction_bits = rng.choice([0, 0, 8, 64, 128])
        scaled = sign_a * a * 2**fraction_bits
        divisor = sign_b * b
        quotient = abs(scaled) // abs(divisor)
        if (scaled < 0) != (divisor < 0):
            quotient = -quotient
        remainder = scaled - quotient * divisor
        wide_divide.append(
            {
                'dividend': str(sign_a * a),
                'divisor': str(divisor),
                'fractionBits': fraction_bits,
                'quotient': str(quotient),
                'remainder': str(remainder),
                'exact': remainder == 0,
            }
        )

    # §17–§18. A separate generator instance, so adding this section leaves
    # every fixture above byte-identical — the file is committed, the
    # instruction is to read the diff, and a diff full of reshuffled random
    # values would bury the one line that mattered.
    limbs = limb_section(random.Random(SEED * 31 + 18))

    generator = io.open(os.path.abspath(__file__), 'rb').read()
    rotation = rotation_section()

    document = {
        'note': (
            'Generated by tools/oracle.py using fractions.Fraction and struct. '
            'Do not hand-edit: regenerate and read the diff.'
        ),
        'seed': SEED,
        'generatorSha256': hashlib.sha256(generator).hexdigest(),
        'arithmetic': arithmetic,
        'magnitudes': magnitudes,
        'decimals': decimals,
        'encodings': encodings,
        'neighbourhoods': neighbourhoods,
        'q128': q128,
        'planck': planck,
        'errorMeter': meter,
        'wideMultiply': wide_multiply,
        'wideDivide': wide_divide,
        'limbs': limbs,
        'rotation': rotation,
    }

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(document, indent=1, ensure_ascii=False) + '\n'
    )
    limb_count = sum(
        len(limbs[key]) for key in ('encoding', 'add', 'sub', 'bitlen', 'shl', 'shr', 'mulWide', 'divRem')
    )
    print(
        'wrote %s: %d arithmetic, %d magnitudes, %d decimals, %d encodings, '
        '%d neighbourhoods, %d q128, %d planck, %d error meter, %d wide multiply, '
        '%d wide divide, %d limb cases'
        % (
            os.path.relpath(OUT, HERE),
            len(arithmetic),
            len(magnitudes),
            len(decimals),
            len(encodings),
            len(neighbourhoods),
            len(q128),
            len(planck),
            len(meter),
            len(wide_multiply),
            len(wide_divide),
            limb_count,
        )
    )


if __name__ == '__main__':
    main()
