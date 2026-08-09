import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatEngineering,
  formatQuantity,
  formatRawSi,
  formatScientific,
} from './format';
import { fromUnit, quantity, zeroQuantity } from '../quantities/quantity';
import { ONE, pow10, rational } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';

const metres = (literal: string) => quantity('length', parseDecimalExact(literal));

describe('engineering notation', () => {
  it('uses the SI prefix that keeps the mantissa in [1, 1000)', () => {
    expect(formatEngineering(metres('0.0000075')).text).toBe('7.5 µm');
    expect(formatEngineering(metres('0.0032')).text).toBe('3.2 mm');
    expect(formatEngineering(metres('1700')).text).toBe('1.7 km');
    expect(formatEngineering(metres('1')).text).toBe('1 m');
    expect(formatEngineering(metres('999')).text).toBe('999 m');
    expect(formatEngineering(metres('1000')).text).toBe('1 km');
  });

  it('never selects a non-engineering prefix', () => {
    // 0.05 m is 50 mm, not 5 cm — centi is not an engineering prefix.
    expect(formatEngineering(metres('0.05')).unit).toBe('mm');
    expect(formatEngineering(metres('0.05')).text).toBe('50 mm');
  });

  it('handles negative values and zero', () => {
    expect(formatEngineering(metres('-0.0032')).text).toBe('-3.2 mm');
    expect(formatEngineering(zeroQuantity('length')).text).toBe('0 m');
  });

  it('formats time in the same way', () => {
    expect(formatEngineering(fromUnit(ONE, 'ms')).text).toBe('1 ms');
    expect(formatEngineering(fromUnit(parseDecimalExact('90'), 'min')).text).toBe('5.4 ks');
  });

  it('leaves the mantissa outside [1, 1000) past the defined prefix range', () => {
    // ~8.8e26 m, the observable universe diameter, is 880 Ym.
    expect(formatEngineering(metres('8.8e26')).text).toBe('880 Ym');
    // Beyond quetta the prefix clamps rather than being invented.
    expect(formatEngineering(metres('1e35')).text).toBe('100000 Qm');
  });

  it('reports whether the rendered text is exact', () => {
    expect(formatEngineering(metres('0.0032')).exact).toBe(true);
    expect(formatEngineering(quantity('length', rational(1n, 3n))).exact).toBe(false);
  });

  it('honours a forced display unit without altering the value', () => {
    const length = metres('0.0032');
    expect(formatEngineering(length, { unit: 'µm' }).text).toBe('3200 µm');
    expect(formatEngineering(length, { unit: 'm' }).text).toBe('0.0032 m');
    expect(length.value).toEqual(parseDecimalExact('0.0032'));
  });

  it('respects significantDigits', () => {
    const third = quantity('length', rational(1n, 3n));
    expect(formatEngineering(third, { significantDigits: 3 }).text).toBe('333 mm');
    expect(formatEngineering(third, { significantDigits: 6 }).text).toBe('333.333 mm');
  });
});

describe('beyond the SI prefixes, engineering notation stops being notation', () => {
  const m = (exponent: number) => quantity('length', pow10(exponent));

  it('still uses a prefix while one exists', () => {
    expect(formatEngineering(m(-30)).text).toBe('1 qm');
    expect(formatEngineering(m(30)).text).toBe('1 Qm');
  });

  it('lets the mantissa leave [1, 1000) while it stays legible', () => {
    // This is the documented intent, and `100000 Qm` is what it is for.
    expect(formatEngineering(m(35)).text).toBe('100000 Qm');
    expect(formatEngineering(m(-33)).text).toBe('0.001 qm');
  });

  it('does not print three hundred digits when the prefixes run out', () => {
    // At 10^-310 the same clamping produced 285 characters of "0.000…001 qm" —
    // correct, and not a rendering of anything. The Microscope set that in a
    // sentence and the panel scrolled to 2200 px.
    for (const exponent of [-100, -310, 100, 400]) {
      const text = formatEngineering(m(exponent)).text;
      expect(text.length, `10^${exponent} rendered as ${text.slice(0, 40)}…`).toBeLessThan(24);
    }
  });

  it('falls back to a power of ten in the canonical unit', () => {
    expect(formatEngineering(m(-310)).text).toBe('1 × 10^-310 m');
    expect(formatEngineering(m(400)).text).toBe('1 × 10^400 m');
    expect(formatEngineering(m(-310)).unit).toBe('m');
  });

  it('keeps the value exact across the fallback', () => {
    expect(formatEngineering(m(-310)).exact).toBe(true);
  });

  it('leaves an explicitly requested unit alone', () => {
    // Asking for a unit is asking for that unit, however the digits come out.
    expect(formatEngineering(m(-310), { unit: 'm' }).unit).toBe('m');
  });
});

describe('scientific notation', () => {
  it('renders mantissa × 10^exponent in canonical SI units', () => {
    expect(formatScientific(metres('0.0000075')).text).toBe('7.5 × 10^-6 m');
    expect(formatScientific(metres('1700')).text).toBe('1.7 × 10^3 m');
    expect(formatScientific(metres('-0.0032')).text).toBe('-3.2 × 10^-3 m');
    expect(formatScientific(zeroQuantity('length')).text).toBe('0 m');
  });

  it('positions values binary64 cannot represent', () => {
    expect(formatScientific(quantity('length', pow10(400))).text).toBe('1 × 10^400 m');
  });
});

describe('raw SI', () => {
  it('renders a plain decimal in the canonical unit', () => {
    expect(formatRawSi(metres('0.0000075')).text).toBe('0.0000075 m');
    expect(formatRawSi(metres('1700')).text).toBe('1700 m');
  });
});

describe('formatQuantity dispatch', () => {
  it('defaults to engineering and switches on mode', () => {
    const length = metres('0.0032');
    expect(formatQuantity(length).text).toBe('3.2 mm');
    expect(formatQuantity(length, { mode: 'engineering' }).text).toBe('3.2 mm');
    expect(formatQuantity(length, { mode: 'scientific' }).text).toBe('3.2 × 10^-3 m');
    expect(formatQuantity(length, { mode: 'raw' }).text).toBe('0.0032 m');
  });

  it('produces the same underlying value in every mode', () => {
    const length = metres('0.0032');
    const before = length.value;
    formatQuantity(length, { mode: 'engineering' });
    formatQuantity(length, { mode: 'scientific' });
    formatQuantity(length, { mode: 'raw' });
    expect(length.value).toEqual(before);
  });
});

describe('formatCount', () => {
  it('renders comparator counts plainly in the readable range', () => {
    expect(formatCount(rational(400n, 3n)).text).toBe('133.3');
    expect(formatCount(rational(123n)).text).toBe('123');
  });

  it('switches to scientific form for extreme counts', () => {
    // How many Planck lengths in a millimetre — a number the UI must not print in full.
    expect(formatCount(pow10(31)).text).toBe('1 × 10^31');
    expect(formatCount(rational(1n, 10n ** 20n)).text).toBe('1 × 10^-20');
  });

  it('reports exactness', () => {
    expect(formatCount(rational(123n)).exact).toBe(true);
    expect(formatCount(rational(400n, 3n)).exact).toBe(false);
  });
});
