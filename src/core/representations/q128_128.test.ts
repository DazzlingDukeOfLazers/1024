import { describe, expect, it } from 'vitest';
import {
  DEFAULT_Q128_128_CONFIG,
  Q128_128_PRESETS,
  addMeters,
  decodeMeters,
  encodeMeters,
  halfLsbMeters,
  isExactlyRepresentable,
  physicalLsbMeters,
  physicalRangeMeters,
  q128State,
  summarize,
} from './q128_128';
import { ONE, ZERO, abs, div, gt, lt, mul, pow10, pow2, rational, sub } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';
import { fromUnit, quantity } from '../quantities/quantity';
import { formatEngineering } from '../units/format';

const r = rational;
const AT_M = DEFAULT_Q128_128_CONFIG;

describe('the default machine is Q128.128 @ m', () => {
  it('uses one metre per machine unit', () => {
    expect(AT_M.baseUnitLabel).toBe('m');
    expect(AT_M.baseUnitMeters).toEqual(ONE);
    expect(AT_M.rounding).toBe('nearest-even');
    expect(AT_M.overflow).toBe('checked');
  });

  it('has a physical LSB of 2^-128 m', () => {
    expect(physicalLsbMeters(AT_M)).toEqual(pow2(-128));
    expect(halfLsbMeters(AT_M)).toEqual(pow2(-129));
  });
});

describe('exactly representable values at @m', () => {
  // docs/NUMERICS.md §5: the intuitive metric machine is still fundamentally binary.
  const exact = [ONE, r(1n, 2n), r(1n, 4n), r(1n, 8n), r(-1n), r(1024n), ZERO];
  const quantized = [
    fromUnit(ONE, 'mm').value,
    fromUnit(ONE, 'cm').value,
    parseDecimalExact('0.1'),
    r(1n, 3n),
  ];

  it('represents powers of two exactly', () => {
    for (const value of exact) {
      expect(isExactlyRepresentable(AT_M, value)).toBe(true);
      const write = encodeMeters(AT_M, value);
      expect(write.decodedMeters).toEqual(value);
      expect(write.quantizationErrorMeters).toEqual(ZERO);
    }
  });

  it('quantizes 1 mm, 1 cm, 0.1 m and 1/3 m', () => {
    for (const value of quantized) {
      expect(isExactlyRepresentable(AT_M, value)).toBe(false);
      const write = encodeMeters(AT_M, value);
      expect(write.quantizationErrorMeters).not.toEqual(ZERO);
      // Still within half an LSB — quantized is not the same as wrong.
      expect(lt(abs(write.quantizationErrorMeters!), halfLsbMeters(AT_M))).toBe(true);
    }
  });

  it('exposes the quantization instead of hiding it', () => {
    const write = encodeMeters(AT_M, fromUnit(ONE, 'mm').value);
    expect(write.status).toBe('stored');
    // 2^128 / 1000 has fractional part 0.456, so nearest-even rounds down.
    expect(write.state?.raw).toBe(2n ** 128n / 1000n);
    // The error is real but absurdly small: about 10^-39 m.
    const error = abs(write.quantizationErrorMeters!);
    expect(lt(error, pow10(-38))).toBe(true);
    expect(gt(error, ZERO)).toBe(true);
  });
});

describe('same 256 bits, pick your ruler', () => {
  it('trades range against resolution as the base unit changes', () => {
    const mm = summarize(Q128_128_PRESETS.mm);
    const m = summarize(Q128_128_PRESETS.m);
    const km = summarize(Q128_128_PRESETS.km);

    // Every configuration is the same register.
    for (const s of [mm, m, km]) {
      expect(s.widthBits).toBe(256);
      expect(s.fractionBits).toBe(128);
    }

    // Finer LSB, smaller range, in lockstep.
    expect(lt(mm.lsbMeters, m.lsbMeters)).toBe(true);
    expect(lt(m.lsbMeters, km.lsbMeters)).toBe(true);
    expect(lt(mm.maxMeters, m.maxMeters)).toBe(true);
    expect(lt(m.maxMeters, km.maxMeters)).toBe(true);

    // Exactly a factor of 1000 either way.
    expect(div(m.lsbMeters, mm.lsbMeters)).toEqual(r(1000n));
    expect(div(km.maxMeters, m.maxMeters)).toEqual(r(1000n));
  });

  it('makes 1 mm exactly representable at @mm but not at @m', () => {
    const oneMillimetre = fromUnit(ONE, 'mm').value;
    expect(isExactlyRepresentable(Q128_128_PRESETS.mm, oneMillimetre)).toBe(true);
    expect(isExactlyRepresentable(Q128_128_PRESETS.m, oneMillimetre)).toBe(false);

    expect(encodeMeters(Q128_128_PRESETS.mm, oneMillimetre).quantizationErrorMeters).toEqual(ZERO);
    expect(encodeMeters(Q128_128_PRESETS.m, oneMillimetre).quantizationErrorMeters).not.toEqual(
      ZERO,
    );
  });

  it('decodes the same raw pattern to different physical magnitudes', () => {
    const raw = { format: q128State().format, raw: 2n ** 128n };
    expect(decodeMeters(Q128_128_PRESETS.mm, raw)).toEqual(pow10(-3));
    expect(decodeMeters(Q128_128_PRESETS.m, raw)).toEqual(ONE);
    expect(decodeMeters(Q128_128_PRESETS.km, raw)).toEqual(pow10(3));
  });

  it('keeps a 1024-bit spacetime coordinate absurdly larger than the universe', () => {
    // Observable universe radius is roughly 4.4e26 m.
    const universeRadius = parseDecimalExact('4.4e26');
    expect(gt(summarize(Q128_128_PRESETS.m).maxMeters, universeRadius)).toBe(true);
  });
});

describe('machine base unit is not display unit', () => {
  it('changing the display unit leaves machine state untouched', () => {
    const value = parseDecimalExact('0.0032');
    const write = encodeMeters(AT_M, value);
    const rawBefore = write.state?.raw;

    const asMillimetres = formatEngineering(quantity('length', value), { unit: 'mm' });
    const asMicrometres = formatEngineering(quantity('length', value), { unit: 'µm' });

    expect(asMillimetres.text).toBe('3.2 mm');
    expect(asMicrometres.text).toBe('3200 µm');
    expect(write.state?.raw).toBe(rawBefore);
    expect(AT_M.baseUnitLabel).toBe('m');
  });

  it('changing the machine base unit produces a different register', () => {
    const value = parseDecimalExact('0.0032');
    const atM = encodeMeters(Q128_128_PRESETS.m, value);
    const atMm = encodeMeters(Q128_128_PRESETS.mm, value);
    expect(atM.state?.raw).not.toBe(atMm.state?.raw);
    // Same physical intent, different grids, different residual error.
    expect(atM.quantizationErrorMeters).not.toEqual(atMm.quantizationErrorMeters);
  });
});

describe('addMeters', () => {
  it('adds a representable operand exactly', () => {
    const result = addMeters(AT_M, q128State(), r(1n, 4n));
    expect(result.operandQuantizationErrorMeters).toEqual(ZERO);
    expect(result.operationErrorMeters).toEqual(ZERO);
    expect(result.decodedMeters).toEqual(r(1n, 4n));
  });

  it('separates operand quantization from operation rounding', () => {
    const result = addMeters(AT_M, q128State(), fromUnit(ONE, 'mm').value);
    // The millimetre had to be quantized on the way in...
    expect(result.operandQuantizationErrorMeters).not.toEqual(ZERO);
    // ...but the integer addition that followed was exact.
    expect(result.operationErrorMeters).toEqual(ZERO);
  });

  it('drifts predictably over a thousand millimetres', () => {
    // Every step adds the same quantized operand, so total error is exactly
    // 1000× the per-step error. No self-correction, no cancellation.
    const oneMillimetre = fromUnit(ONE, 'mm').value;
    const perStep = addMeters(AT_M, q128State(), oneMillimetre).operandQuantizationErrorMeters;

    let state = q128State();
    for (let i = 0; i < 1000; i += 1) {
      state = addMeters(AT_M, state, oneMillimetre).state!;
    }
    const divergence = sub(decodeMeters(AT_M, state), ONE);
    expect(divergence).toEqual(mul(perStep, r(1000n)));
    expect(divergence).not.toEqual(ZERO);
  });

  it('refuses to overflow the register', () => {
    const nearMax = encodeMeters(AT_M, physicalRangeMeters(AT_M).max);
    const result = addMeters(AT_M, nearMax.state!, ONE);
    expect(result.status).toBe('rejected');
    expect(result.overflow?.direction).toBe('above');
  });
});
