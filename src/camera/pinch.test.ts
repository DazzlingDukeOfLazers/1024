import { describe, expect, it } from 'vitest';
import { type Pinch, pinchLog10Delta, pinchOf, pinchScale } from './pinch';

describe('pinchOf', () => {
  it('reduces two touches to a spread and a midpoint', () => {
    expect(pinchOf([100, 300])).toEqual({ spread: 200, center: 200 });
  });

  it('does not care which finger is which', () => {
    expect(pinchOf([300, 100])).toEqual(pinchOf([100, 300]));
  });

  it('is undefined for anything other than two touches', () => {
    expect(pinchOf([])).toBeUndefined();
    expect(pinchOf([100])).toBeUndefined();
    expect(pinchOf([100, 200, 300])).toBeUndefined();
  });

  it('never reports a zero spread, which would make every later ratio infinite', () => {
    expect(pinchOf([200, 200])?.spread).toBe(1);
    expect(pinchScale(pinchOf([200, 200])!, pinchOf([200, 400])!)).toBe(200);
  });
});

describe('pinchScale', () => {
  const at = (a: number, b: number): Pinch => pinchOf([a, b])!;

  it('is greater than one when the fingers move apart', () => {
    expect(pinchScale(at(150, 250), at(100, 300))).toBe(2);
  });

  it('is less than one when they come together', () => {
    expect(pinchScale(at(100, 300), at(150, 250))).toBe(0.5);
  });

  it('is one when they only move together', () => {
    expect(pinchScale(at(100, 300), at(300, 500))).toBe(1);
  });
});

describe('pinchLog10Delta', () => {
  const at = (a: number, b: number): Pinch => pinchOf([a, b])!;

  it('is negative when spreading, because the view shows less', () => {
    // A tenfold spread is exactly one decade of scale, the other way.
    expect(pinchLog10Delta(at(195, 205), at(150, 250))).toBeCloseTo(-1, 12);
  });

  it('is positive when pinching in', () => {
    expect(pinchLog10Delta(at(150, 250), at(195, 205))).toBeCloseTo(1, 12);
  });

  it('composes: two halves of a gesture equal the whole', () => {
    const a = at(180, 220);
    const b = at(160, 240);
    const c = at(120, 280);
    expect(pinchLog10Delta(a, b) + pinchLog10Delta(b, c)).toBeCloseTo(pinchLog10Delta(a, c), 12);
  });
});
