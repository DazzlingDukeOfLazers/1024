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

Python is a *poor* oracle for the rest of the project, and deliberately is not
asked: its ints are unbounded, so a Q128.128 register or a 256-bit Planck tick
would silently succeed in Python exactly where the real design constraint is
finiteness. Rounding is shared ground; overflow is not.

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

    generator = io.open(os.path.abspath(__file__), 'rb').read()
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
    }

    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(document, indent=1, ensure_ascii=False) + '\n'
    )
    print(
        'wrote %s: %d arithmetic, %d magnitudes, %d decimals, %d encodings, %d neighbourhoods'
        % (
            os.path.relpath(OUT, HERE),
            len(arithmetic),
            len(magnitudes),
            len(decimals),
            len(encodings),
            len(neighbourhoods),
        )
    )


if __name__ == '__main__':
    main()
