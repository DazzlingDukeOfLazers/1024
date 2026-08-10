import { describe, expect, it } from 'vitest';
import {
  ANGLE_PERIOD,
  REFERENCE_DIGITS,
  angleInPi,
  belowReferenceFloor,
  crossoverStep,
  referencePoint,
  runAngle,
  runComposed,
} from './angleTrack';
import {
  type Rational,
  ONE,
  ZERO,
  add,
  compare,
  equals,
  mul,
  rational,
} from '../rational/rational';
import { encodeRational, exactValue } from '../representations/binary64';
import { Q128_128_PRESETS, encodeMeters as encodeQ128 } from '../representations/q128_128';

const asBinary64 = (value: Rational) => {
  const encoded = encodeRational(value);
  return encoded.state.kind === 'finite' ? exactValue(encoded.state.value) : undefined;
};
const asQ128 = (value: Rational) => encodeQ128(Q128_128_PRESETS['m']!, value).decoded;

describe('the angle, which is the exact half', () => {
  it('is dyadic, so a π-scaled binary register holds it exactly', () => {
    // The whole reason this angle and not a nicer-looking one: k/8 has a
    // power-of-two denominator, so it lands on the grid of a binary register
    // scaled by π. A step of π/6 would not.
    for (let step = 0; step < ANGLE_PERIOD * 3; step += 1) {
      const denominator = angleInPi(step).denominator;
      // A power of two after normalizing — 8/8 reduces to 1/1, and 2/8 to 1/4,
      // which are still dyadic. A step of π/6 would leave a 3 in here.
      expect(denominator & (denominator - 1n), `step ${step}`).toBe(0n);
    }
  });

  it('wraps a full turn to exactly zero, not nearly zero', () => {
    expect(equals(angleInPi(0), ZERO)).toBe(true);
    expect(equals(angleInPi(ANGLE_PERIOD), ZERO)).toBe(true);
    expect(equals(angleInPi(ANGLE_PERIOD * 25), ZERO)).toBe(true);
    // A half turn is exactly 1 in units of π, which is the point of the unit.
    expect(equals(angleInPi(ANGLE_PERIOD / 2), ONE)).toBe(true);
  });

  it('never drifts, however long the run', () => {
    // Integer arithmetic on the numerator. Step n and step n + 16 are the same
    // angle, exactly, for every n — which is what gives the angle track a
    // ceiling the composing track has no way to reach.
    for (const step of [1, 17, 33, 1601]) {
      expect(equals(angleInPi(step), rational(1n, 8n)), `step ${step}`).toBe(true);
    }
  });
});

describe('the reference, which is the declared half', () => {
  it('is exact at the quarter turns and declared everywhere else', () => {
    // Niven's theorem: the only rational multiples of π with rational sine are
    // the ones giving 0, ±1/2 and ±1. At π/8 that means the quarter turns and
    // nothing else, so those four are the only steps this project can call
    // exact — and the fixture marks them rather than leaving it to be guessed.
    for (let step = 0; step < ANGLE_PERIOD; step += 1) {
      expect(referencePoint(step).exact, `step ${step}`).toBe(step % 4 === 0);
    }
  });

  it('puts the quarter turns exactly on the axes', () => {
    expect(referencePoint(0).point).toEqual({ x: ONE, y: ZERO });
    expect(referencePoint(4).point.x).toEqual(ZERO);
    expect(equals(referencePoint(4).point.y, ONE)).toBe(true);
    expect(equals(referencePoint(8).point.x, rational(-1n))).toBe(true);
    expect(referencePoint(8).point.y).toEqual(ZERO);
  });

  it('stays on the unit circle to the digits it claims', () => {
    // The reference is not exact, so this is the honest version of the check
    // `rotation.ts` makes with `toEqual(ONE)`: |x² + y² − 1| is below the last
    // declared digit rather than zero.
    for (let step = 0; step < ANGLE_PERIOD; step += 1) {
      const { x, y } = referencePoint(step).point;
      const off = add(mul(x, x), mul(y, y));
      // The first-order floor, not the squared one: `x² + y² − 1` is a residue
      // of the same order as the reference's own error, not a squared distance.
      expect(belowReferenceFloor(add(off, rational(-1n))), `step ${step}`).toBe(true);
    }
  });

  it('is declared to more digits than any machine here can hold', () => {
    // 60 digits against binary64's 17 and Q128.128's 38. A float reference
    // could not have measured the fixed-point machine's error at all.
    expect(REFERENCE_DIGITS).toBeGreaterThan(38);
  });
});

describe('composing against accumulating', () => {
  it('lands the angle track exactly right at every quarter turn', () => {
    // The headline. 400 steps, 100 quarter turns, and at every one of them the
    // angle track is not close to the truth but on it — because the angle is
    // exact and the machine can hold 0 and ±1 exactly.
    const angle = runAngle('b64', 'binary64', asBinary64, 400);
    expect(angle.exactSteps).toBe(100);

    const composed = runComposed('b64', 'binary64', asBinary64, 400);
    expect(composed.exactSteps).toBe(0);
  });

  it('gives the angle track a ceiling and the composing track none', () => {
    // Step n and step n + 16 ask the angle track the identical question, so its
    // worst is set in the first turn and never beaten. Composing has no such
    // property: Q128.128 is still getting worse after a full turn.
    expect(runAngle('q', 'q', asQ128, 400).withinFirstTurn).toBe(true);
    expect(runComposed('q', 'q', asQ128, 400).withinFirstTurn).toBe(false);
  });

  it('crosses over almost immediately', () => {
    // Composing pays nothing up front and accumulates; the angle pays one
    // rounding and then stops paying. Measured, and sharper than expected:
    // composing is ahead for a single step on both machines.
    for (const quantize of [asBinary64, asQ128]) {
      const composed = runComposed('m', 'm', quantize, 400);
      const angle = runAngle('m', 'm', quantize, 400);
      expect(crossoverStep(composed, angle)).toBe(2);
    }
  });

  it('ends with the composing track further out on both machines', () => {
    for (const quantize of [asBinary64, asQ128]) {
      const composed = runComposed('m', 'm', quantize, 400);
      const angle = runAngle('m', 'm', quantize, 400);
      expect(compare(composed.worstError, angle.worstError)).toBeGreaterThan(0);
    }
  });

  it('separates the machines, as everything else here does', () => {
    // Q128.128's composed error is decades below binary64's. The strategy
    // question and the representation question are independent.
    const float = runComposed('b64', 'b64', asBinary64, 400);
    const fixed = runComposed('q', 'q', asQ128, 400);
    expect(compare(fixed.worstError, float.worstError)).toBeLessThan(0);
  });

  it('is exact on both tracks when the machine is', () => {
    // Anti-vacuity: hand both tracks a quantizer that does nothing and every
    // error collapses to the reference's own, which is zero by construction.
    // So the differences above belong to the machines, not to the runner.
    // Sixteen steps rather than four hundred, because composing *without*
    // quantizing is the one path where the exact rationals are never cut back:
    // each step multiplies two 60-digit references, so the denominator gains
    // about 120 digits a step and the run stops being quick. That is the same
    // "exactness does not fit" cost `rotation.ts` measures in digits, arriving
    // here as a test that timed out.
    const composed = runComposed('exact', 'exact', (value) => value, 16);
    const angle = runAngle('exact', 'exact', (value) => value, 16);
    expect(angle.exactSteps).toBe(16);
    expect(equals(angle.worstError, ZERO)).toBe(true);
    // Composing still drifts, because it never reads the reference back: it
    // multiplies its own answer by a matrix built once. That is the strategy
    // failing rather than the machine, which is the distinction being drawn.
    expect(compare(composed.worstError, ZERO)).toBeGreaterThan(0);
  });
});
