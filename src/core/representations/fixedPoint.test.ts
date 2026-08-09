import { describe, expect, it } from 'vitest';
import {
  type FixedPointFormat,
  Q128_128,
  Q512_512,
  addExact,
  decode,
  encode,
  fromJSON,
  halfLsb,
  integerBits,
  isWithinHalfLsb,
  lsb,
  maxValue,
  minValue,
  rawBinary,
  rawHex,
  toJSON,
  zeroState,
} from './fixedPoint';
import { ONE, ZERO, equals, pow2, rational, sub } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';

const r = rational;
const Q4_4: FixedPointFormat = { widthBits: 8, fractionBits: 4 };

describe('format geometry', () => {
  it('splits width into integer and fraction bits', () => {
    expect(integerBits(Q128_128)).toBe(128);
    expect(integerBits(Q512_512)).toBe(512);
    expect(Q128_128.widthBits).toBe(256);
    expect(Q512_512.widthBits).toBe(1024);
  });

  it('has a constant LSB of 2^-fractionBits', () => {
    expect(lsb(Q128_128)).toEqual(pow2(-128));
    expect(lsb(Q512_512)).toEqual(pow2(-512));
    expect(halfLsb(Q128_128)).toEqual(pow2(-129));
  });

  it('spans the signed range of the register', () => {
    expect(maxValue(Q4_4)).toEqual(r(127n, 16n));
    expect(minValue(Q4_4)).toEqual(r(-8n));
    expect(maxValue(Q128_128)).toEqual(r(2n ** 255n - 1n, 2n ** 128n));
    expect(minValue(Q128_128)).toEqual(r(-(2n ** 127n)));
  });
});

describe('encode and decode', () => {
  it('represents dyadic rationals exactly', () => {
    for (const value of [ZERO, ONE, r(-1n), r(1n, 2n), r(1n, 4n), r(1n, 8n), r(-3n, 16n)]) {
      const write = encode(Q4_4, value);
      expect(write.status).toBe('stored');
      expect(write.decoded).toEqual(value);
      expect(write.quantizationError).toEqual(ZERO);
    }
  });

  it('quantizes non-dyadic values and reports the error', () => {
    const write = encode(Q4_4, r(1n, 10n));
    expect(write.status).toBe('stored');
    // 0.1 × 16 = 1.6, nearest is 2 -> 2/16 = 0.125
    expect(write.decoded).toEqual(r(1n, 8n));
    expect(write.quantizationError).toEqual(r(1n, 40n));
    expect(isWithinHalfLsb(Q4_4, write.quantizationError!)).toBe(true);
  });

  it('never exceeds half an LSB under nearest-even rounding', () => {
    for (let n = -200n; n <= 200n; n += 1n) {
      for (const d of [3n, 7n, 10n, 11n, 13n]) {
        const write = encode(Q4_4, r(n, d));
        if (write.status !== 'stored') continue;
        expect(isWithinHalfLsb(Q4_4, write.quantizationError!)).toBe(true);
      }
    }
  });

  it('keeps spacing constant across the range, unlike floating point', () => {
    const low = encode(Q4_4, r(1n, 16n));
    const high = encode(Q4_4, r(7n));
    const step = lsb(Q4_4);
    for (const write of [low, high]) {
      const next = decode({ format: Q4_4, raw: write.state!.raw + 1n });
      expect(sub(next, write.decoded!)).toEqual(step);
    }
  });

  it('refuses out-of-range values in checked mode', () => {
    const write = encode(Q4_4, r(100n));
    expect(write.status).toBe('rejected');
    expect(write.state).toBeUndefined();
    expect(write.overflow?.direction).toBe('above');
  });

  it('wraps or saturates only when asked', () => {
    expect(encode(Q4_4, r(100n), 'nearest-even', 'saturate').decoded).toEqual(maxValue(Q4_4));
    expect(encode(Q4_4, r(100n), 'nearest-even', 'wrap').status).toBe('wrapped');
  });

  it('honours the named rounding mode', () => {
    expect(encode(Q4_4, r(1n, 10n), 'floor').decoded).toEqual(r(1n, 16n));
    expect(encode(Q4_4, r(1n, 10n), 'ceil').decoded).toEqual(r(1n, 8n));
    expect(encode(Q4_4, r(1n, 32n), 'nearest-even').decoded).toEqual(ZERO);
  });
});

describe('addExact', () => {
  it('quantizes the operand but adds exactly', () => {
    const start = encode(Q4_4, r(1n, 2n)).state!;
    const result = addExact(start, r(1n, 10n));

    expect(result.status).toBe('stored');
    // The operand was rounded to 2/16; the integer addition itself added nothing.
    expect(result.operandQuantizationError).toEqual(r(1n, 40n));
    expect(result.operationError).toEqual(ZERO);
    expect(result.decoded).toEqual(r(5n, 8n));
  });

  it('keeps the operation exact over a long run of representable operands', () => {
    // 1/16 is exactly representable at Q4.4, so this must land exactly on 4.
    let state = zeroState(Q4_4);
    for (let i = 0; i < 64; i += 1) {
      const result = addExact(state, r(1n, 16n));
      expect(result.operandQuantizationError).toEqual(ZERO);
      expect(result.operationError).toEqual(ZERO);
      state = result.state!;
    }
    expect(decode(state)).toEqual(r(4n));
  });

  it('accumulates operand error without ever correcting itself', () => {
    // 1/10 is not representable; ten additions must NOT produce exactly 1.
    let state = zeroState(Q4_4);
    for (let i = 0; i < 10; i += 1) {
      state = addExact(state, r(1n, 10n)).state!;
    }
    expect(decode(state)).toEqual(r(5n, 4n));
    expect(equals(decode(state), ONE)).toBe(false);
  });

  it('reports overflow instead of silently growing the register', () => {
    const start = encode(Q4_4, r(7n)).state!;
    const result = addExact(start, r(7n));
    expect(result.status).toBe('rejected');
    expect(result.state).toBeUndefined();
    expect(result.overflow?.direction).toBe('above');
  });
});

describe('inspection and serialization', () => {
  it('renders raw patterns at full width', () => {
    const state = encode(Q4_4, r(-1n, 2n)).state!;
    expect(rawHex(state)).toBe('0xf8');
    expect(rawBinary(state)).toBe('11111000');
    expect(rawHex(zeroState(Q128_128))).toBe(`0x${'0'.repeat(64)}`);
  });

  it('round-trips through JSON without a BigInt ever becoming a number', () => {
    const state = encode(Q128_128, parseDecimalExact('0.1')).state!;
    const json = toJSON(state);

    expect(json).toEqual({
      rawHex: expect.any(String),
      signed: true,
      integerBits: 128,
      fractionBits: 128,
    });
    expect(JSON.stringify(json)).toContain('0x');
    expect(fromJSON(JSON.parse(JSON.stringify(json)))).toEqual(state);
  });
});
