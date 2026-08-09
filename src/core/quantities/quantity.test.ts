import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  equals,
  fromUnit,
  negate,
  quantity,
  ratio,
  scale,
  sub,
  toUnit,
  zeroQuantity,
} from './quantity';
import { ONE, ZERO, pow10, rational } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';
import { UnitError } from '../units/units';

const r = rational;

describe('unit conversion', () => {
  it('stores 1 mm as exactly 1/1000 m', () => {
    const oneMillimetre = fromUnit(ONE, 'mm');
    expect(oneMillimetre.dimension).toBe('length');
    expect(oneMillimetre.value).toEqual({ numerator: 1n, denominator: 1000n });
  });

  it('round-trips through display units without changing the value', () => {
    const length = fromUnit(parseDecimalExact('7.5'), 'µm');
    const before = length.value;

    expect(toUnit(length, 'µm')).toEqual(parseDecimalExact('7.5'));
    expect(toUnit(length, 'nm')).toEqual(r(7500n));
    expect(toUnit(length, 'm')).toEqual(r(3n, 400000n));
    expect(toUnit(length, 'km')).toEqual(r(3n, 400000000n));

    // Reading a quantity in different units must not mutate it.
    expect(length.value).toEqual(before);
  });

  it('keeps exactness across large unit spans', () => {
    const kilometre = fromUnit(ONE, 'km');
    expect(toUnit(kilometre, 'µm')).toEqual(r(1000000000n));
    expect(toUnit(kilometre, 'Gm')).toEqual(r(1n, 1000000n));
  });

  it('handles exact time units', () => {
    expect(fromUnit(ONE, 'h').value).toEqual(r(3600n));
    expect(toUnit(fromUnit(ONE, 'a'), 'd')).toEqual(parseDecimalExact('365.25'));
  });

  it('refuses to express a length in a time unit', () => {
    expect(() => toUnit(fromUnit(ONE, 'm'), 's')).toThrow(UnitError);
  });
});

describe('arithmetic', () => {
  const mm = (n: bigint) => fromUnit(r(n), 'mm');

  it('adds and subtracts within a dimension', () => {
    expect(add(mm(1n), mm(2n)).value).toEqual(r(3n, 1000n));
    expect(sub(mm(1n), mm(2n)).value).toEqual(r(-1n, 1000n));
    expect(negate(mm(1n)).value).toEqual(r(-1n, 1000n));
  });

  it('accumulates a million millimetres to exactly 1000 m', () => {
    // The exact reference answer for the headline drift experiment. This is the
    // truth the finite machines will be measured against, so it must be exact.
    const oneMillimetre = fromUnit(ONE, 'mm');
    const total = scale(oneMillimetre, r(1000000n));
    expect(total.value).toEqual(r(1000n));
    expect(toUnit(total, 'km')).toEqual(ONE);
  });

  it('survives the large-offset cancellation exactly', () => {
    // +1e20 m, +1 mm, -1e20 m — binary64 loses the millimetre; exact does not.
    const offset = quantity('length', pow10(20));
    const millimetre = fromUnit(ONE, 'mm');
    const result = sub(add(add(zeroQuantity('length'), offset), millimetre), offset);
    expect(result.value).toEqual(r(1n, 1000n));

    // The same sequence in binary64 loses it entirely.
    expect(1e20 + 0.001 - 1e20).toBe(0);
  });

  it('refuses to add across dimensions', () => {
    expect(() => add(fromUnit(ONE, 'm'), fromUnit(ONE, 's') as never)).toThrow(UnitError);
  });
});

describe('ratio and comparison', () => {
  it('answers how many red blood cells span a millimetre', () => {
    // 7.5 µm is a representative diameter; the ratio itself is exact given it.
    const cell = fromUnit(parseDecimalExact('7.5'), 'µm');
    const millimetre = fromUnit(ONE, 'mm');
    expect(ratio(millimetre, cell)).toEqual(r(400n, 3n));
  });

  it('is undefined against a zero quantity', () => {
    expect(() => ratio(fromUnit(ONE, 'm'), zeroQuantity('length'))).toThrow(UnitError);
  });

  it('orders and compares', () => {
    expect(compare(fromUnit(ONE, 'mm'), fromUnit(ONE, 'm'))).toBe(-1);
    expect(compare(fromUnit(r(1000n), 'mm'), fromUnit(ONE, 'm'))).toBe(0);
    expect(equals(fromUnit(r(100n), 'cm'), fromUnit(ONE, 'm'))).toBe(true);
    expect(equals(quantity('length', ZERO), quantity('time', ZERO))).toBe(false);
  });
});
