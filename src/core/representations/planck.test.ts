import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANCK_CONFIG,
  PLANCK_REGISTER_WIDTH,
  addMeters,
  decodeTicks,
  encodeMeters,
  encodeSeconds,
  metersToPlanckLengths,
  summarizeLength,
  summarizeTime,
  zeroTicks,
} from './planck';
import {
  CODATA_2018,
  PLANCK_LENGTH,
  PLANCK_TIME,
  SPEED_OF_LIGHT,
  relativeUncertainty,
} from './constants';
import { ONE, ZERO, abs, gt, lt, lte, mul, rational, sub } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';
import { orderOfMagnitude10 } from '../rational/log10';
import { fromUnit } from '../quantities/quantity';

const r = rational;

describe('declared constants', () => {
  it('treats c as exact, because SI defines it', () => {
    expect(SPEED_OF_LIGHT.nominal).toEqual(r(299792458n));
    expect(SPEED_OF_LIGHT.uncertainty).toBeUndefined();
    expect(relativeUncertainty(SPEED_OF_LIGHT)).toBeUndefined();
  });

  it('carries provenance and uncertainty for measured constants', () => {
    expect(PLANCK_LENGTH.source).toBe('CODATA');
    expect(PLANCK_LENGTH.sourceVersion).toBe('2018');
    expect(PLANCK_LENGTH.declaredDigits).toBe(7);
    expect(PLANCK_LENGTH.nominal).toEqual(parseDecimalExact('1.616255e-35'));

    // ~1.1e-5 relative, dominated by the uncertainty in G.
    const relative = relativeUncertainty(PLANCK_LENGTH);
    expect(relative).toBeDefined();
    expect(orderOfMagnitude10(relative!)).toBe(-5);
  });

  it('encodes the nominal declaration exactly, digits and all', () => {
    // The declaration is a decimal string; storing it as a rational keeps every
    // declared digit rather than rounding it into a double.
    expect(PLANCK_TIME.nominal).toEqual(r(5391247n, 10n ** 50n));
  });

  it('freezes a whole constant set together, so an experiment is reproducible', () => {
    expect(CODATA_2018.id).toBe('codata-2018');
    expect(CODATA_2018.planckLength).toBe(PLANCK_LENGTH);
    expect(CODATA_2018.planckTime).toBe(PLANCK_TIME);
    expect(DEFAULT_PLANCK_CONFIG.constants).toBe(CODATA_2018);
  });
});

describe('an irresponsible amount of coordinate space', () => {
  it('uses 256 bits per axis, 1024 for spacetime', () => {
    expect(PLANCK_REGISTER_WIDTH).toBe(256);
    expect(summarizeLength().widthBits).toBe(256);
    expect(summarizeTime().widthBits).toBe(256);
  });

  it('reaches far beyond the observable universe at Planck resolution', () => {
    // Observable universe radius ~4.4e26 m. The register's reach is ~10^41 m.
    const reach = summarizeLength().max;
    expect(gt(reach, parseDecimalExact('4.4e26'))).toBe(true);
    expect(orderOfMagnitude10(reach)).toBeGreaterThan(40);
  });

  it('has an absolute resolution of exactly one nominal Planck length', () => {
    expect(summarizeLength().lsb).toEqual(PLANCK_LENGTH.nominal);
    expect(summarizeTime().lsb).toEqual(PLANCK_TIME.nominal);
  });
});

describe('quantization onto the Planck grid', () => {
  it('rounds to whole ticks and reports the residue', () => {
    const write = encodeMeters(ONE);
    expect(write.status).toBe('stored');
    expect(write.state?.ticks).toBeTypeOf('bigint');
    expect(write.quantizationError).not.toEqual(ZERO);
    // Never more than half a Planck length off.
    expect(lte(abs(write.quantizationError!), mul(PLANCK_LENGTH.nominal, r(1n, 2n)))).toBe(true);
  });

  it('represents whole multiples of the nominal constant exactly', () => {
    const threeTicks = mul(PLANCK_LENGTH.nominal, r(3n));
    const write = encodeMeters(threeTicks);
    expect(write.state?.ticks).toBe(3n);
    expect(write.quantizationError).toEqual(ZERO);
  });

  it('quantizes durations against the Planck time, not the Planck length', () => {
    const write = encodeSeconds(mul(PLANCK_TIME.nominal, r(7n)));
    expect(write.state?.ticks).toBe(7n);
    expect(write.quantizationError).toEqual(ZERO);
  });

  it('decodes ticks back through the same declared constant', () => {
    expect(decodeTicks(PLANCK_LENGTH, { ticks: 5n })).toEqual(mul(PLANCK_LENGTH.nominal, r(5n)));
  });

  it('counts Planck lengths without quantizing, for display', () => {
    const millimetre = fromUnit(ONE, 'mm').value;
    const count = metersToPlanckLengths(millimetre);
    // A millimetre is roughly 6.2e31 Planck lengths.
    expect(orderOfMagnitude10(count)).toBe(31);
  });

  it('refuses a length beyond the register rather than wrapping silently', () => {
    const write = encodeMeters(parseDecimalExact('1e60'));
    expect(write.status).toBe('rejected');
    expect(write.overflow?.direction).toBe('above');
  });
});

describe('addMeters', () => {
  it('adds whole ticks exactly', () => {
    const result = addMeters(zeroTicks(), mul(PLANCK_LENGTH.nominal, r(10n)));
    expect(result.operandQuantizationError).toEqual(ZERO);
    expect(result.operationError).toEqual(ZERO);
    expect(result.state?.ticks).toBe(10n);
  });

  it('separates operand quantization from the exact integer addition', () => {
    const result = addMeters(zeroTicks(), ONE);
    expect(result.operandQuantizationError).not.toEqual(ZERO);
    expect(result.operationError).toEqual(ZERO);
  });

  it('accumulates operand error linearly without self-correcting', () => {
    const millimetre = fromUnit(ONE, 'mm').value;
    const perStep = addMeters(zeroTicks(), millimetre).operandQuantizationError;

    let state = zeroTicks();
    for (let i = 0; i < 100; i += 1) {
      state = addMeters(state, millimetre).state!;
    }
    const divergence = sub(decodeTicks(PLANCK_LENGTH, state), mul(millimetre, r(100n)));
    expect(divergence).toEqual(mul(perStep, r(100n)));
  });
});

describe('physical uncertainty is not numerical error', () => {
  it('keeps them at different magnitudes and in different places', () => {
    // The grid's quantization residue for 1 m is ~10^-35 m...
    const quantization = abs(encodeMeters(ONE).quantizationError!);
    expect(lt(quantization, PLANCK_LENGTH.nominal)).toBe(true);

    // ...while the constant's own measurement uncertainty is ~10^-40 m, and it
    // lives on the constant, never in a write result.
    const uncertainty = PLANCK_LENGTH.uncertainty;
    expect(uncertainty?.kind).toBe('absolute');
    expect(orderOfMagnitude10(uncertainty!.value)).toBe(-40);
    expect(encodeMeters(ONE)).not.toHaveProperty('uncertainty');
  });
});
