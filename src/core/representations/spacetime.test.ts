import { describe, expect, it } from 'vitest';
import {
  SPACETIME_TOTAL_BITS,
  createMetricSpacetime,
  createPlanckSpacetime,
  ctMetersFromSeconds,
  secondsFromCtMeters,
  totalBits,
} from './spacetime';
import { DEFAULT_Q128_128_CONFIG, Q128_128_PRESETS } from './q128_128';
import { SPEED_OF_LIGHT } from './constants';
import { ONE, mul, rational } from '../rational/rational';
import { fromUnit } from '../quantities/quantity';

const r = rational;

describe('both frames spend exactly 1024 bits', () => {
  it('gives the metric frame four 256-bit fixed-point registers', () => {
    const frame = createMetricSpacetime(DEFAULT_Q128_128_CONFIG);
    expect(totalBits(frame)).toBe(SPACETIME_TOTAL_BITS);
    for (const register of [frame.x, frame.y, frame.z, frame.ct]) {
      expect(register.format.widthBits).toBe(256);
      expect(register.format.fractionBits).toBe(128);
      expect(register.raw).toBe(0n);
    }
  });

  it('gives the Planck frame four 256-bit integer registers', () => {
    const frame = createPlanckSpacetime();
    expect(totalBits(frame)).toBe(SPACETIME_TOTAL_BITS);
    for (const register of [frame.x, frame.y, frame.z, frame.t]) {
      expect(register.ticks).toBe(0n);
    }
  });

  it('carries the base-unit configuration with the metric frame', () => {
    expect(createMetricSpacetime(Q128_128_PRESETS.km).config.baseUnitLabel).toBe('km');
    expect(createMetricSpacetime(Q128_128_PRESETS.mm).config.baseUnitLabel).toBe('mm');
  });
});

describe('ct as the fourth coordinate', () => {
  it('converts exactly, because c is exact by definition', () => {
    expect(ctMetersFromSeconds(ONE)).toEqual(r(299792458n));
    expect(ctMetersFromSeconds(ONE)).toEqual(SPEED_OF_LIGHT.nominal);
  });

  it('round-trips without loss', () => {
    for (const seconds of [ONE, r(1n, 3n), fromUnit(ONE, 'ms').value, r(-7n, 11n)]) {
      expect(secondsFromCtMeters(ctMetersFromSeconds(seconds))).toEqual(seconds);
    }
  });

  it('makes one light-second a plain length', () => {
    expect(ctMetersFromSeconds(fromUnit(ONE, 'ms').value)).toEqual(
      mul(SPEED_OF_LIGHT.nominal, r(1n, 1000n)),
    );
  });

  it('gives all four axes the same physical dimension', () => {
    // The point of storing ct rather than t: the register is geometrically
    // homogeneous, so the same base unit applies to every axis.
    const frame = createMetricSpacetime(Q128_128_PRESETS.m);
    expect(frame.ct.format).toEqual(frame.x.format);
  });
});
