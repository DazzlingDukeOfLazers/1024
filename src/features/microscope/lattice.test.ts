import { describe, expect, it } from 'vitest';
import {
  baseUnitSummaries,
  binary64LatticeReport,
  defaultProfiles,
  errorMagnitude,
  localSpacing,
  planckLatticeReport,
  q128LatticeReport,
} from './lattice';
import {
  ONE,
  ZERO,
  abs,
  equals,
  gt,
  lt,
  lte,
  pow2,
  pow10,
  rational,
  sub,
} from '../../core/rational/rational';
import { parseDecimalExact } from '../../core/rational/parse';
import { Q128_128_PRESETS } from '../../core/representations/q128_128';
import { PLANCK_LENGTH } from '../../core/representations/constants';
import { fromUnit } from '../../core/quantities/quantity';

const r = rational;

describe('Q128.128 sees a constant grid', () => {
  const report = q128LatticeReport(Q128_128_PRESETS.m, ONE, 3);

  it('spaces its neighbours by exactly one LSB, both ways', () => {
    expect(report.constantSpacing).toEqual(pow2(-128));
    expect(report.gapBelow).toEqual(pow2(-128));
    expect(report.gapAbove).toEqual(pow2(-128));
    expect(report.asymmetric).toBe(false);
  });

  it('lays the samples out evenly around the nearest value', () => {
    expect(report.samples).toHaveLength(7);
    for (let i = 1; i < report.samples.length; i += 1) {
      expect(sub(report.samples[i]!.value, report.samples[i - 1]!.value)).toEqual(pow2(-128));
    }
    expect(report.samples[3]!.index).toBe(0);
    expect(report.samples[3]!.value).toEqual(report.nearest);
  });

  it('holds one metre exactly', () => {
    expect(report.nearest).toEqual(ONE);
    expect(report.quantizationError).toEqual(ZERO);
    expect(report.raw).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('keeps the same spacing at a wildly different magnitude', () => {
    // The claim the acceptance criterion rests on.
    const tiny = q128LatticeReport(Q128_128_PRESETS.m, pow10(-20), 1);
    const huge = q128LatticeReport(Q128_128_PRESETS.m, pow10(30), 1);
    expect(tiny.constantSpacing).toEqual(report.constantSpacing);
    expect(huge.constantSpacing).toEqual(report.constantSpacing);
  });

  it('changes its grid when the machine base unit changes', () => {
    const atMm = q128LatticeReport(Q128_128_PRESETS.mm, ONE, 1);
    const atKm = q128LatticeReport(Q128_128_PRESETS.km, ONE, 1);
    expect(lt(atMm.constantSpacing!, report.constantSpacing!)).toBe(true);
    expect(gt(atKm.constantSpacing!, report.constantSpacing!)).toBe(true);
  });

  it('says so when a value is out of range', () => {
    const report = q128LatticeReport(Q128_128_PRESETS.mm, pow10(80), 1);
    expect(report.samples).toEqual([]);
    expect(report.nearest).toBeUndefined();
    expect(report.note).toContain('Out of range');
  });
});

describe('binary64 sees a grid that spreads out', () => {
  it('reports both gaps separately at a power of two', () => {
    const report = binary64LatticeReport(ONE, 3);
    expect(report.gapBelow).toEqual(pow2(-53));
    expect(report.gapAbove).toEqual(pow2(-52));
    expect(report.asymmetric).toBe(true);
    expect(report.note).toContain('power-of-two boundary');
  });

  it('reports equal gaps away from a power of two', () => {
    const report = binary64LatticeReport(parseDecimalExact('1.5'), 3);
    expect(report.gapBelow).toEqual(report.gapAbove);
    expect(report.asymmetric).toBe(false);
  });

  it('has no constant spacing to offer', () => {
    expect(binary64LatticeReport(ONE, 1).constantSpacing).toBeUndefined();
  });

  it('spreads out as the magnitude grows', () => {
    // The other half of the acceptance criterion.
    const near1 = localSpacing(binary64LatticeReport(ONE, 0))!;
    const near1e6 = localSpacing(binary64LatticeReport(pow10(6), 0))!;
    const near1e20 = localSpacing(binary64LatticeReport(pow10(20), 0))!;

    expect(lt(near1, near1e6)).toBe(true);
    expect(lt(near1e6, near1e20)).toBe(true);
    expect(near1e20).toEqual(pow2(14));
  });

  it('walks real neighbours, not multiples of a nominal gap', () => {
    const report = binary64LatticeReport(ONE, 2);
    const values = report.samples.map((sample) => sample.value);
    // Below 1 the spacing is half what it is above, so the samples are not
    // evenly spaced — which is exactly the thing a constant LSB would hide.
    const below = sub(values[2]!, values[1]!);
    const above = sub(values[3]!, values[2]!);
    expect(equals(below, above)).toBe(false);
    expect(below).toEqual(pow2(-53));
    expect(above).toEqual(pow2(-52));
  });

  it('records the exact stored value and its raw bits', () => {
    const report = binary64LatticeReport(parseDecimalExact('0.1'), 1);
    expect(report.nearest).toEqual(r(3602879701896397n, 2n ** 55n));
    expect(report.quantizationError).not.toEqual(ZERO);
    expect(report.raw).toBe('0x3fb999999999999a');
  });

  it('says so when a value cannot be finite', () => {
    const report = binary64LatticeReport(pow10(400), 1);
    expect(report.nearest).toBeUndefined();
    expect(report.samples).toEqual([]);
    expect(report.note).toContain('positive-infinity');
  });
});

describe('the subnormal range, where binary64 stops being floating point', () => {
  it('has constant spacing, which is the opposite of the usual story', () => {
    // Below 2^-1022 the exponent cannot go lower, so the significand absorbs the
    // shrinking on its own and every value is a multiple of one fixed quantum.
    const report = binary64LatticeReport(pow10(-310), 2);
    expect(report.gapBelow).toEqual(pow2(-1074));
    expect(report.gapAbove).toEqual(pow2(-1074));
    expect(report.asymmetric).toBe(false);
    expect(report.subnormal).toBe(true);
    expect(report.constantSpacing).toEqual(pow2(-1074));
  });

  it('does not tell the reader its spacing grows here, because it does not', () => {
    const report = binary64LatticeReport(pow10(-310), 1);
    expect(report.note).not.toContain('grows with magnitude');
    expect(report.note).toContain('subnormal');
    expect(report.note).toContain('2^-1074');
  });

  it('is flat across the whole subnormal range, unlike anywhere else', () => {
    const at320 = localSpacing(binary64LatticeReport(pow10(-320), 0))!;
    const at310 = localSpacing(binary64LatticeReport(pow10(-310), 0))!;
    // Ten decades apart and the same spacing. Ten decades apart in the normal
    // range is ten decades of spacing.
    expect(at320).toEqual(at310);
    expect(localSpacing(binary64LatticeReport(pow10(-30), 0))).not.toEqual(at310);
  });

  it('calls the smallest normal what it is: the one boundary that is symmetric', () => {
    // Every other power of two has a gap below half the gap above. Here the
    // subnormal grid underneath already has the wider spacing, so they match.
    const report = binary64LatticeReport(pow2(-1022), 1);
    expect(report.subnormal).toBe(false);
    expect(report.gapBelow).toEqual(pow2(-1074));
    expect(report.gapAbove).toEqual(pow2(-1074));
    expect(report.asymmetric).toBe(false);
    expect(report.note).toContain('smallest normal');
  });

  it('still reaches the last value before zero', () => {
    const report = binary64LatticeReport(pow2(-1074), 1);
    expect(report.nearest).toEqual(pow2(-1074));
    expect(report.subnormal).toBe(true);
    expect(report.note).toContain('subnormal');
  });
});

describe('the Planck grid', () => {
  it('has one tick of constant spacing', () => {
    const report = planckLatticeReport(ONE, 2);
    expect(report.constantSpacing).toEqual(PLANCK_LENGTH.nominal);
    expect(report.asymmetric).toBe(false);
    expect(report.raw).toContain('ticks');
    expect(report.note).toContain('CODATA 2018');
  });
});

describe('which machine is finer depends on where you stand', () => {
  it('puts binary64 coarser than Q128.128 @ m at human scale', () => {
    const q = localSpacing(q128LatticeReport(Q128_128_PRESETS.m, ONE, 0))!;
    const b = localSpacing(binary64LatticeReport(ONE, 0))!;
    expect(lt(q, b)).toBe(true);
  });

  it('puts binary64 finer than Q128.128 @ m far below it', () => {
    // Fixed point is not uniformly better. Below about 10^-23 m the constant
    // grid is coarser than a float that has followed the magnitude down.
    const magnitude = pow10(-30);
    const q = localSpacing(q128LatticeReport(Q128_128_PRESETS.m, magnitude, 0))!;
    const b = localSpacing(binary64LatticeReport(magnitude, 0))!;
    expect(lt(b, q)).toBe(true);
  });

  it('puts binary64 finer than the Planck grid below about a zeptometre', () => {
    const magnitude = pow10(-30);
    const planck = localSpacing(planckLatticeReport(magnitude, 0))!;
    const b = localSpacing(binary64LatticeReport(magnitude, 0))!;
    expect(lt(b, planck)).toBe(true);
  });
});

describe('the resolution profile', () => {
  const profiles = defaultProfiles('m', -30, 20);

  it('draws binary64 as a line that climbs', () => {
    const binary64 = profiles.find((profile) => profile.id === 'binary64')!;
    expect(binary64.constant).toBe(false);

    const gaps = binary64.samples.map((sample) => sample.log10Gap!);
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
    }
    // Roughly one decade of spacing per decade of magnitude.
    expect(gaps.at(-1)! - gaps[0]!).toBeCloseTo(50, 0);
  });

  it('draws the fixed-point machines as flat lines', () => {
    for (const id of ['q128.128@m', 'planck-int256']) {
      const profile = profiles.find((entry) => entry.id === id)!;
      expect(profile.constant).toBe(true);
      const gaps = profile.samples.map((sample) => sample.log10Gap!);
      expect(new Set(gaps.map((gap) => gap.toFixed(9))).size).toBe(1);
    }
  });

  it('shows the lines crossing, so neither machine looks uniformly better', () => {
    const binary64 = profiles.find((profile) => profile.id === 'binary64')!;
    const q128 = profiles.find((profile) => profile.id === 'q128.128@m')!;
    const flat = q128.samples[0]!.log10Gap!;

    const first = binary64.samples[0]!.log10Gap!;
    const last = binary64.samples.at(-1)!.log10Gap!;
    expect(first).toBeLessThan(flat);
    expect(last).toBeGreaterThan(flat);
  });

  it('follows the selected base unit', () => {
    const atMm = defaultProfiles('mm', -10, 0).find((entry) => entry.id === 'q128.128@mm')!;
    const atKm = defaultProfiles('km', -10, 0).find((entry) => entry.id === 'q128.128@km')!;
    expect(atMm.samples[0]!.log10Gap!).toBeLessThan(atKm.samples[0]!.log10Gap!);
  });
});

describe('same 256 bits, pick your ruler', () => {
  const summaries = baseUnitSummaries(fromUnit(ONE, 'mm').value);

  it('reports every preset at the same width', () => {
    expect(summaries.map((entry) => entry.preset)).toEqual(['mm', 'm', 'km', 'Mm']);
    for (const entry of summaries) expect(entry.widthBits).toBe(256);
  });

  it('trades range against resolution in lockstep', () => {
    for (let i = 1; i < summaries.length; i += 1) {
      expect(lt(summaries[i - 1]!.lsbMeters, summaries[i]!.lsbMeters)).toBe(true);
      expect(lt(summaries[i - 1]!.maxMeters, summaries[i]!.maxMeters)).toBe(true);
    }
  });

  it('marks a millimetre exact at @mm and quantized elsewhere', () => {
    expect(summaries.find((entry) => entry.preset === 'mm')!.exact).toBe(true);
    expect(summaries.find((entry) => entry.preset === 'm')!.exact).toBe(false);
    expect(summaries.find((entry) => entry.preset === 'km')!.exact).toBe(false);
  });

  it('keeps every quantization within half an LSB', () => {
    for (const entry of summaries) {
      if (entry.quantizationError === undefined) continue;
      const half = {
        numerator: entry.lsbMeters.numerator,
        denominator: entry.lsbMeters.denominator * 2n,
      };
      expect(lte(abs(entry.quantizationError), half)).toBe(true);
    }
  });
});

describe('errorMagnitude', () => {
  it('is zero when the value is held exactly', () => {
    expect(errorMagnitude(q128LatticeReport(Q128_128_PRESETS.m, ONE, 0))).toEqual(ZERO);
  });

  it('is positive when it is not', () => {
    expect(gt(errorMagnitude(binary64LatticeReport(parseDecimalExact('0.1'), 0)), ZERO)).toBe(true);
  });
});
