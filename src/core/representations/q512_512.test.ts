import { describe, expect, it } from 'vitest';
import {
  Q512_512_FORMAT,
  accumulate,
  accumulateAbsolute,
  accumulatorHalfLsb,
  accumulatorLsb,
  accumulatorRange,
  createAccumulator,
  readAccumulator,
} from './q512_512';
import {
  ZERO,
  abs,
  add,
  equals,
  gt,
  lt,
  lte,
  mul,
  pow2,
  rational,
  sub,
} from '../rational/rational';

const r = rational;

describe('the error meter is a finite 1024-bit machine', () => {
  it('is Q512.512, decoding as raw / 2^512', () => {
    expect(Q512_512_FORMAT.widthBits).toBe(1024);
    expect(Q512_512_FORMAT.fractionBits).toBe(512);
    expect(accumulatorLsb()).toEqual(pow2(-512));
    expect(accumulatorHalfLsb()).toEqual(pow2(-513));
  });

  it('starts at exactly zero', () => {
    expect(readAccumulator(createAccumulator())).toEqual(ZERO);
  });

  it('has a range, unlike the exact reference', () => {
    const { min, max } = accumulatorRange();
    expect(max).toEqual(r(2n ** 1023n - 1n, 2n ** 512n));
    expect(min).toEqual(r(-(2n ** 511n)));
  });
});

describe('accumulation', () => {
  it('sums dyadic contributions exactly', () => {
    let state = createAccumulator();
    for (const contribution of [r(1n, 2n), r(1n, 4n), r(-1n, 8n)]) {
      state = accumulate(state, contribution).state;
    }
    expect(readAccumulator(state)).toEqual(r(5n, 8n));
  });

  it('lets signed errors cancel, which is why absolute totals are tracked too', () => {
    const signed = accumulate(accumulate(createAccumulator(), r(1n, 4n)).state, r(-1n, 4n)).state;
    expect(readAccumulator(signed)).toEqual(ZERO);

    let absolute = createAccumulator();
    for (const contribution of [r(1n, 4n), r(-1n, 4n)]) {
      absolute = accumulateAbsolute(absolute, contribution).state;
    }
    expect(readAccumulator(absolute)).toEqual(r(1n, 2n));
  });

  it('accumulates a million tiny contributions', () => {
    const contribution = pow2(-100);
    let state = createAccumulator();
    for (let i = 0; i < 1000; i += 1) {
      const result = accumulate(state, contribution);
      expect(result.meterQuantizationError).toEqual(ZERO);
      state = result.state;
    }
    expect(readAccumulator(state)).toEqual(mul(contribution, r(1000n)));
  });

  it('quantizes contributions finer than its own LSB, and says so', () => {
    // 2^-600 is below the meter's 2^-512 resolution. A finite meter measuring
    // finite error has error of its own, and that is a result worth showing.
    const belowResolution = pow2(-600);
    const result = accumulate(createAccumulator(), belowResolution);

    expect(readAccumulator(result.state)).toEqual(ZERO);
    expect(result.meterQuantizationError).toEqual(sub(ZERO, belowResolution));
    expect(lte(abs(result.meterQuantizationError), accumulatorHalfLsb())).toBe(true);
  });

  it('never introduces more than half an LSB per contribution', () => {
    let state = createAccumulator();
    for (const contribution of [r(1n, 3n), r(1n, 7n), r(-1n, 11n), pow2(-513), pow2(-514)]) {
      const result = accumulate(state, contribution);
      expect(lte(abs(result.meterQuantizationError), accumulatorHalfLsb())).toBe(true);
      state = result.state;
    }
  });

  it('saturates loudly rather than dropping an enormous contribution', () => {
    const { max } = accumulatorRange();
    const first = accumulate(createAccumulator(), max);
    expect(first.overflow).toBeUndefined();

    const second = accumulate(first.state, max);
    expect(second.overflow?.direction).toBe('above');
    expect(readAccumulator(second.state)).toEqual(max);
  });

  it('can be refused instead, when a demonstration wants that', () => {
    const { max } = accumulatorRange();
    const pinned = accumulate(createAccumulator(), max).state;
    const refused = accumulate(pinned, max, 'checked');
    expect(refused.overflow?.mode).toBe('checked');
    // A refused write leaves the meter where it was.
    expect(equals(readAccumulator(refused.state), max)).toBe(true);
  });
});

describe('the meter is not the exact reference', () => {
  it('drifts from an exact running total once contributions go below its LSB', () => {
    const contribution = pow2(-520);
    let meter = createAccumulator();
    let exact = ZERO;

    for (let i = 0; i < 8; i += 1) {
      meter = accumulate(meter, contribution).state;
      exact = add(exact, contribution);
    }

    // Exact truth is unbounded; the finite meter rounded every step to zero.
    expect(gt(exact, ZERO)).toBe(true);
    expect(readAccumulator(meter)).toEqual(ZERO);
    expect(lt(sub(exact, readAccumulator(meter)), accumulatorLsb())).toBe(true);
  });
});
