import { describe, expect, it } from 'vitest';
import {
  type Binary64State,
  EXPONENT_BIAS,
  FRACTION_BITS,
  MAX_FINITE_EXPONENT,
  MIN_SUBNORMAL_EXPONENT,
  addRational,
  bitsOf,
  encodeRational,
  errorInLocalGaps,
  exactValue,
  fields,
  fromNumber,
  isFiniteState,
  isNegativeZero,
  neighbors,
  numberFromBits,
  predecessor,
  relativeError,
  successor,
  toNumber,
} from './binary64';
import { ONE, ZERO, abs, equals, lt, mul, pow2, rational, sub } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';
import { toExactDecimalString } from '../rational/decimal';
import { orderOfMagnitude10 } from '../rational/log10';

const r = rational;

/** 0.1 as a double is exactly 3602879701896397 / 2^55. */
const STORED_POINT_ONE = r(3602879701896397n, 2n ** 55n);

describe('known bit patterns', () => {
  it('decodes the canonical values', () => {
    expect(bitsOf(0)).toBe(0n);
    expect(bitsOf(-0)).toBe(1n << 63n);
    expect(bitsOf(1)).toBe(0x3ff0000000000000n);
    expect(bitsOf(-1)).toBe(0xbff0000000000000n);
    expect(bitsOf(0.5)).toBe(0x3fe0000000000000n);
    expect(bitsOf(2)).toBe(0x4000000000000000n);
    expect(bitsOf(Number.POSITIVE_INFINITY)).toBe(0x7ff0000000000000n);
    expect(bitsOf(Number.MIN_VALUE)).toBe(1n);
  });

  it('round-trips bits through numbers', () => {
    for (const value of [0, -0, 1, -1, 0.5, 0.1, Number.MAX_VALUE, Number.MIN_VALUE]) {
      expect(bitsOf(numberFromBits(bitsOf(value)))).toBe(bitsOf(value));
    }
  });

  it('splits the sign, exponent and fraction fields', () => {
    const one = fields(1);
    expect(one.signBit).toBe(0);
    expect(one.exponentField).toBe(EXPONENT_BIAS);
    expect(one.fractionField).toBe(0n);
    expect(one.unbiasedExponent).toBe(0);
    expect(one.significand).toBe(1n << 52n);
    expect(one.bitsHex).toBe('0x3ff0000000000000');
    expect(one.bitsBinary).toBe(`0 | 01111111111 | ${'0'.repeat(52)}`);

    const negativeHalf = fields(-0.5);
    expect(negativeHalf.signBit).toBe(1);
    expect(negativeHalf.unbiasedExponent).toBe(-1);
  });

  it('recognises subnormals and the smallest normal', () => {
    const smallestSubnormal = fields(Number.MIN_VALUE);
    expect(smallestSubnormal.isSubnormal).toBe(true);
    expect(smallestSubnormal.exponentField).toBe(0);
    expect(smallestSubnormal.significand).toBe(1n);

    const smallestNormal = fields(2 ** -1022);
    expect(smallestNormal.isSubnormal).toBe(false);
    expect(smallestNormal.exponentField).toBe(1);
    expect(smallestNormal.unbiasedExponent).toBe(-1022);
  });

  it('gives the largest finite double its full 53-bit significand', () => {
    const max = fields(Number.MAX_VALUE);
    expect(max.unbiasedExponent).toBe(MAX_FINITE_EXPONENT);
    expect(max.significand).toBe((1n << 53n) - 1n);
    expect(exactValue(Number.MAX_VALUE)).toEqual(
      mul(r((1n << 53n) - 1n), pow2(MAX_FINITE_EXPONENT - FRACTION_BITS)),
    );
  });
});

describe('state categories', () => {
  it('keeps +0 and -0 distinguishable even though both decode to zero', () => {
    const positive = fromNumber(0);
    const negative = fromNumber(-0);

    expect(positive.kind).toBe('finite');
    expect(negative.kind).toBe('finite');
    if (!isFiniteState(positive) || !isFiniteState(negative)) throw new Error('expected finite');

    expect(positive.signBit).toBe(0);
    expect(negative.signBit).toBe(1);
    expect(positive.exact).toEqual(ZERO);
    expect(negative.exact).toEqual(ZERO);

    // `===` cannot tell them apart; the sign bit and Object.is can.
    expect(Object.is(0, -0)).toBe(false);
    expect(isNegativeZero(-0)).toBe(true);
    expect(isNegativeZero(0)).toBe(false);
  });

  it('categorises the infinities', () => {
    expect(fromNumber(Number.POSITIVE_INFINITY)).toEqual({ kind: 'positive-infinity' });
    expect(fromNumber(Number.NEGATIVE_INFINITY)).toEqual({ kind: 'negative-infinity' });
    expect(exactValue(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('categorises NaN and keeps its payload bits', () => {
    const state = fromNumber(Number.NaN);
    expect(state.kind).toBe('nan');
    if (state.kind !== 'nan') throw new Error('expected NaN');
    expect(state.payloadBits).toBeTypeOf('bigint');
    expect(state.payloadBits).not.toBe(0n);
    expect(exactValue(Number.NaN)).toBeUndefined();
  });

  it('round-trips every category back to a number', () => {
    expect(toNumber(fromNumber(1.5))).toBe(1.5);
    expect(toNumber(fromNumber(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY);
    expect(toNumber(fromNumber(Number.NEGATIVE_INFINITY))).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(toNumber(fromNumber(Number.NaN)))).toBe(true);
  });
});

describe('exact decoding', () => {
  it('reads 0.1 straight out of the bits, not out of a printed string', () => {
    expect(exactValue(0.1)).toEqual(STORED_POINT_ONE);
    expect(toExactDecimalString(STORED_POINT_ONE)).toBe(
      '0.1000000000000000055511151231257827021181583404541015625',
    );
    // The intent and the storage are different rational numbers.
    expect(equals(STORED_POINT_ONE, parseDecimalExact('0.1'))).toBe(false);
  });

  it('decodes integers inside the exact range without loss', () => {
    for (const value of [0, 1, -1, 42, 2 ** 52, Number.MAX_SAFE_INTEGER]) {
      expect(exactValue(value)).toEqual(r(BigInt(value)));
    }
  });

  it('decodes subnormals against the fixed quantum', () => {
    expect(exactValue(Number.MIN_VALUE)).toEqual(pow2(MIN_SUBNORMAL_EXPONENT));
    expect(exactValue(5 * Number.MIN_VALUE)).toEqual(mul(r(5n), pow2(MIN_SUBNORMAL_EXPONENT)));
  });

  it('decodes negatives symmetrically', () => {
    expect(exactValue(-0.1)).toEqual(sub(ZERO, STORED_POINT_ONE));
  });
});

describe('neighbours and gaps', () => {
  it('steps to adjacent representable values', () => {
    expect(successor(1)).toBe(1 + Number.EPSILON);
    expect(predecessor(1)).toBe(1 - Number.EPSILON / 2);
    expect(successor(0)).toBe(Number.MIN_VALUE);
    expect(predecessor(0)).toBe(-Number.MIN_VALUE);
    expect(successor(-0)).toBe(Number.MIN_VALUE);
    expect(successor(-Number.MIN_VALUE)).toBe(-0);
    expect(isNegativeZero(successor(-Number.MIN_VALUE))).toBe(true);
  });

  it('crosses into infinity at the top and stays there', () => {
    expect(successor(Number.MAX_VALUE)).toBe(Number.POSITIVE_INFINITY);
    expect(successor(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(predecessor(-Number.MAX_VALUE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('reports asymmetric gaps at powers of two', () => {
    // The headline reason docs/NUMERICS.md §10 refuses a single "ULP" number.
    const atOne = neighbors(1);
    expect(atOne.gapBelow).toEqual(pow2(-53));
    expect(atOne.gapAbove).toEqual(pow2(-52));
    expect(equals(atOne.gapBelow!, atOne.gapAbove!)).toBe(false);

    for (const exponent of [-4, 0, 4, 20, 64]) {
      const value = 2 ** exponent;
      const { gapBelow, gapAbove } = neighbors(value);
      expect(gapBelow).toEqual(pow2(exponent - 53));
      expect(gapAbove).toEqual(pow2(exponent - 52));
    }
  });

  it('reports equal gaps away from a power of two', () => {
    const { gapBelow, gapAbove } = neighbors(1.5);
    expect(gapBelow).toEqual(gapAbove);
    expect(gapBelow).toEqual(pow2(-52));
  });

  it('shows the spacing growing with magnitude, unlike fixed point', () => {
    const near1 = neighbors(1).gapAbove!;
    const near1e6 = neighbors(1e6).gapAbove!;
    const near1e20 = neighbors(1e20).gapAbove!;

    expect(lt(near1, near1e6)).toBe(true);
    expect(lt(near1e6, near1e20)).toBe(true);

    // 1e20 sits in [2^66, 2^67), so the local gap is exactly 2^14 m — 16384 m.
    // A millimetre has no chance of surviving an addition there.
    expect(near1e20).toEqual(pow2(14));
    expect(lt(parseDecimalExact('0.001'), near1e20)).toBe(true);
  });

  it('leaves gaps undefined rather than faking them at the boundaries', () => {
    expect(neighbors(Number.MAX_VALUE).gapAbove).toBeUndefined();
    expect(neighbors(Number.MAX_VALUE).above).toEqual({ kind: 'positive-infinity' });
    expect(neighbors(Number.NaN).gapBelow).toBeUndefined();
    expect(neighbors(Number.NaN).gapAbove).toBeUndefined();
  });

  it('has a constant gap across the subnormal range', () => {
    expect(neighbors(Number.MIN_VALUE).gapAbove).toEqual(pow2(MIN_SUBNORMAL_EXPONENT));
    expect(neighbors(5 * Number.MIN_VALUE).gapBelow).toEqual(pow2(MIN_SUBNORMAL_EXPONENT));
  });
});

describe('encoding an exact rational', () => {
  it('rounds 0.1 to the same double the language does', () => {
    const encoded = encodeRational(parseDecimalExact('0.1'));
    expect(isFiniteState(encoded.state)).toBe(true);
    if (!isFiniteState(encoded.state)) throw new Error('expected finite');

    expect(encoded.state.value).toBe(0.1);
    expect(encoded.state.exact).toEqual(STORED_POINT_ONE);
    expect(encoded.quantizationError).toEqual(sub(STORED_POINT_ONE, parseDecimalExact('0.1')));
    // Positive: 0.1 rounds up. About +5.55e-18.
    expect(orderOfMagnitude10(encoded.quantizationError!)).toBe(-18);
  });

  it('agrees with the language across a spread of decimal literals', () => {
    for (const literal of [
      '0.1',
      '0.2',
      '0.3',
      '1',
      '-1.5',
      '1e20',
      '2.5e-7',
      '1234567.891',
      '1e-310',
    ]) {
      const encoded = encodeRational(parseDecimalExact(literal));
      if (!isFiniteState(encoded.state)) throw new Error(`expected finite for ${literal}`);
      expect(encoded.state.value).toBe(Number(literal));
    }
  });

  it('rounds values that have no decimal literal at all', () => {
    // 1/3 has no finite decimal form, so Number(string) could never do this.
    const encoded = encodeRational(r(1n, 3n));
    if (!isFiniteState(encoded.state)) throw new Error('expected finite');
    expect(encoded.state.value).toBe(1 / 3);
    expect(encoded.state.exact).toEqual(exactValue(1 / 3));
  });

  it('represents dyadic rationals with no error at all', () => {
    for (const value of [ONE, r(1n, 2n), r(1n, 4n), r(-3n, 8n), r(1n << 40n)]) {
      const encoded = encodeRational(value);
      expect(encoded.quantizationError).toEqual(ZERO);
    }
  });

  it('never lands further than half the local gap away', () => {
    for (const value of [r(1n, 3n), r(1n, 7n), r(22n, 7n), parseDecimalExact('0.1'), r(-5n, 11n)]) {
      const encoded = encodeRational(value);
      if (!isFiniteState(encoded.state)) throw new Error('expected finite');
      const { gapBelow, gapAbove } = neighbors(encoded.state.value);
      const bound = mul(gapBelow ?? gapAbove!, r(1n, 2n));
      expect(
        lt(abs(encoded.quantizationError!), bound) ||
          equals(abs(encoded.quantizationError!), bound),
      ).toBe(true);
    }
  });

  it('rounds ties to even, like the hardware', () => {
    // Exactly halfway between 1 and its successor: ties-to-even picks 1.
    const halfway = { numerator: 2n ** 53n + 1n, denominator: 2n ** 53n };
    expect(encodeRational(halfway).state).toMatchObject({ value: 1 });

    // Halfway between the successor and the one after: picks the even one.
    const nextHalfway = { numerator: 2n ** 53n + 3n, denominator: 2n ** 53n };
    expect(encodeRational(nextHalfway).state).toMatchObject({ value: 1 + 2 * Number.EPSILON });
  });

  it('overflows to infinity rather than pretending', () => {
    const encoded = encodeRational(parseDecimalExact('1e400'));
    expect(encoded.state).toEqual({ kind: 'positive-infinity' });
    expect(encoded.overflowedToInfinity).toBe(true);
    expect(encoded.quantizationError).toBeUndefined();

    expect(encodeRational(parseDecimalExact('-1e400')).state).toEqual({
      kind: 'negative-infinity',
    });
  });

  it('underflows to a signed zero and says so', () => {
    const encoded = encodeRational(parseDecimalExact('1e-400'));
    expect(encoded.underflowedToZero).toBe(true);
    if (!isFiniteState(encoded.state)) throw new Error('expected finite');
    expect(encoded.state.value).toBe(0);
    // The whole value was lost, and the error records exactly how much.
    expect(encoded.quantizationError).toEqual(sub(ZERO, parseDecimalExact('1e-400')));

    const negative = encodeRational(parseDecimalExact('-1e-400'));
    if (!isFiniteState(negative.state)) throw new Error('expected finite');
    expect(negative.state.signBit).toBe(1);
  });

  it('reaches into the subnormal range correctly', () => {
    expect(encodeRational(pow2(MIN_SUBNORMAL_EXPONENT)).state).toMatchObject({
      value: Number.MIN_VALUE,
    });
    // Half a quantum is a tie against zero; zero is even, so it wins.
    expect(encodeRational(pow2(MIN_SUBNORMAL_EXPONENT - 1)).underflowedToZero).toBe(true);
    // Three quarters of a quantum rounds up to the smallest subnormal.
    expect(encodeRational(mul(r(3n), pow2(MIN_SUBNORMAL_EXPONENT - 2))).state).toMatchObject({
      value: Number.MIN_VALUE,
    });
    // One and a half quanta is another tie, and two quanta is the even one.
    expect(encodeRational(mul(r(3n), pow2(MIN_SUBNORMAL_EXPONENT - 1))).state).toMatchObject({
      value: 2 * Number.MIN_VALUE,
    });
  });

  it('encodes exact zero as +0', () => {
    const encoded = encodeRational(ZERO);
    if (!isFiniteState(encoded.state)) throw new Error('expected finite');
    expect(encoded.state.signBit).toBe(0);
    expect(encoded.quantizationError).toEqual(ZERO);
  });
});

describe('addition with an exact operand', () => {
  const finite = (value: number): Binary64State => fromNumber(value);

  it('reproduces 0.1 + 0.2 and explains it', () => {
    const start = encodeRational(parseDecimalExact('0.1')).state;
    const result = addRational(start, parseDecimalExact('0.2'));

    if (!isFiniteState(result.state)) throw new Error('expected finite');
    expect(result.state.value).toBe(0.30000000000000004);

    // Neither operand was representable, and the sum rounded again on top.
    expect(result.operandQuantizationError).not.toEqual(ZERO);
    expect(result.operationRoundingError).not.toEqual(ZERO);

    // The exact reference says 3/10. The machine does not.
    expect(equals(result.state.exact, parseDecimalExact('0.3'))).toBe(false);
  });

  it('separates operand encoding from the rounding of the addition', () => {
    // Both operands are exactly representable, so only the sum can round.
    const result = addRational(finite(1), pow2(-60));
    expect(result.operandQuantizationError).toEqual(ZERO);
    expect(result.operationRoundingError).toEqual(sub(ZERO, pow2(-60)));

    // And when nothing rounds at all, both are zero.
    const clean = addRational(finite(1), r(1n, 4n));
    expect(clean.operandQuantizationError).toEqual(ZERO);
    expect(clean.operationRoundingError).toEqual(ZERO);
  });

  it('loses a millimetre beside a 1e20 m offset', () => {
    // The large-offset experiment, at the level of one machine.
    const offset = encodeRational(parseDecimalExact('1e20')).state;
    const afterAdd = addRational(offset, parseDecimalExact('0.001'));
    if (!isFiniteState(afterAdd.state)) throw new Error('expected finite');

    expect(afterAdd.state.value).toBe(1e20);

    // The millimetre did not vanish quietly — the whole of it is recorded as
    // rounding error. Note this is the *represented* millimetre, not the exact
    // 1/1000: the operand was already quantized on the way in, and §7 keeps the
    // two contributions apart rather than blaming the addition for both.
    expect(afterAdd.operationRoundingError).toEqual(sub(ZERO, exactValue(0.001)!));
    expect(afterAdd.operandQuantizationError).toEqual(
      sub(exactValue(0.001)!, parseDecimalExact('0.001')),
    );
    expect(equals(exactValue(0.001)!, parseDecimalExact('0.001'))).toBe(false);

    const back = addRational(afterAdd.state, sub(ZERO, parseDecimalExact('1e20')));
    if (!isFiniteState(back.state)) throw new Error('expected finite');
    expect(back.state.value).toBe(0);
  });

  it('propagates infinities without inventing a rational', () => {
    const result = addRational(fromNumber(Number.MAX_VALUE), exactValue(Number.MAX_VALUE)!);
    expect(result.state).toEqual({ kind: 'positive-infinity' });
    expect(result.operationRoundingError).toBeUndefined();
  });
});

describe('error reporting', () => {
  it('computes relative error and refuses it at a zero reference', () => {
    expect(relativeError(r(11n), r(10n))).toEqual(r(1n, 10n));
    expect(relativeError(ZERO, ZERO)).toBeUndefined();
    expect(relativeError(ONE, ZERO)).toBeUndefined();
  });

  it('expresses the error as a fraction of a named local gap', () => {
    const intent = parseDecimalExact('0.1');
    const report = errorInLocalGaps(0.1, intent);
    expect(report).toBeDefined();
    // 0.1 rounded up, so the intent sits in the gap below the stored value.
    expect(report?.gap).toBe('below');
    expect(lt(report!.fractionOfGap, r(1n, 2n))).toBe(true);
  });

  it('reports zero when the stored value is the intent', () => {
    expect(errorInLocalGaps(0.5, r(1n, 2n))?.fractionOfGap).toEqual(ZERO);
  });

  it('is undefined for non-finite storage', () => {
    expect(errorInLocalGaps(Number.POSITIVE_INFINITY, ONE)).toBeUndefined();
  });
});
