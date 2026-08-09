import { describe, expect, it } from 'vitest';
import { builtInFloatingOriginConfig, runFloatingOrigin } from './floatingOrigin';
import { ZERO, abs, equals, lt, pow10, rational } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';

const r = rational;

describe('the built-in configuration', () => {
  it('comes from the authored fixture', () => {
    const config = builtInFloatingOriginConfig();
    expect(config.originMeters).toEqual(pow10(20));
    expect(config.localOffsetMeters).toEqual(r(1n, 1000n));
  });
});

describe('two points 1 mm apart around a 1e20 m origin', () => {
  const result = runFloatingOrigin(builtInFloatingOriginConfig());

  it('sits where binary64 cannot resolve a millimetre at all', () => {
    // The local representable spacing at 1e20 is 16384 m.
    expect(result.gapAtOrigin).toEqual(r(16384n));
    expect(lt(result.localOffsetMeters, result.gapAtOrigin!)).toBe(true);
  });

  it('loses the separation entirely with absolute coordinates', () => {
    expect(result.absolute.separationLost).toBe(true);
    expect(result.absolute.separation).toEqual(ZERO);
    expect(result.absolute.separationError).toEqual(r(-1n, 1000n));
    // Both positions collapsed onto the same double.
    expect(equals(result.absolute.storedA, result.absolute.storedB)).toBe(true);
  });

  it('recovers it exactly once the origin is subtracted first', () => {
    // Same binary64. Same two positions. Different coordinate strategy.
    expect(result.rebased.separationLost).toBe(false);
    expect(result.rebased.storedA).toEqual(ZERO);

    // 1 mm is not exactly representable in binary64, so the recovered
    // separation is quantized — but it is present, and off by ~1e-20 m rather
    // than by the whole millimetre.
    expect(lt(abs(result.rebased.separationError), parseDecimalExact('1e-19'))).toBe(true);
    expect(lt(abs(result.rebased.separationError), abs(result.absolute.separationError))).toBe(
      true,
    );
  });

  it('demonstrates the forbidden path failing, without using it', () => {
    // docs/NUMERICS.md §12: never Number(a) - Number(b) at universe scale.
    expect(result.naiveNumberSeparation).toBe(0);
  });
});

describe('the strategies agree when the origin is small', () => {
  it('makes no difference near zero', () => {
    const result = runFloatingOrigin({
      originMeters: r(1n),
      localOffsetMeters: r(1n, 1000n),
    });
    expect(result.absolute.separationLost).toBe(false);
    expect(result.rebased.separationLost).toBe(false);
    expect(result.naiveNumberSeparation).toBeCloseTo(0.001, 15);
  });
});

describe('the failure scales with the origin', () => {
  it('degrades as the origin grows and the offset stays fixed', () => {
    const offset = r(1n, 1000n);
    let previousError = ZERO;

    for (const exponent of [0, 6, 12, 20]) {
      const result = runFloatingOrigin({
        originMeters: pow10(exponent),
        localOffsetMeters: offset,
      });
      const error = abs(result.absolute.separationError);
      expect(lt(error, previousError)).toBe(false);
      previousError = error;

      // Rebasing keeps the separation usable at every scale.
      expect(result.rebased.separationLost).toBe(false);
    }

    // By 1e20 the absolute strategy has lost the whole millimetre.
    expect(previousError).toEqual(offset);
  });
});
