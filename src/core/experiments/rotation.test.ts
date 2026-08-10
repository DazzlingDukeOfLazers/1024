import { describe, expect, it } from 'vitest';
import {
  ROTATION_COS,
  ROTATION_SIN,
  exactDigitsAfter,
  normSquared,
  rotateExact,
  runRotation,
} from './rotation';
import {
  type Rational,
  ONE,
  ZERO,
  abs,
  add,
  compare,
  equals,
  mul,
  rational,
  sub,
} from '../rational/rational';
import { encodeRational, exactValue } from '../representations/binary64';
import { Q128_128_PRESETS, encodeMeters as encodeQ128 } from '../representations/q128_128';

const START = { x: ONE, y: ZERO };

describe('the rotation itself', () => {
  it('is exactly orthogonal, which is why this angle and not a nice one', () => {
    // cos 1° is irrational, so an exact reference for it would be a fiction and
    // the whole comparison would be against one. 3² + 4² = 5² is not.
    expect(add(mul(ROTATION_COS, ROTATION_COS), mul(ROTATION_SIN, ROTATION_SIN))).toEqual(ONE);
  });

  it('keeps the exact orbit exactly on the circle, for ever', () => {
    let point = START;
    for (let step = 1; step <= 200; step += 1) {
      point = rotateExact(point);
      expect(normSquared(point), `step ${step}`).toEqual(ONE);
    }
  });

  it('never closes, so repetition never gets a free ride', () => {
    // θ is not a rational multiple of a turn, so the orbit is aperiodic: there
    // is no step at which the exact answer helpfully returns to the start. If
    // it did, a long run would be testing a cycle rather than accumulation.
    let point = START;
    for (let step = 1; step <= 200; step += 1) {
      point = rotateExact(point);
      expect(equals(point.x, ONE) && equals(point.y, ZERO), `closed at ${step}`).toBe(false);
    }
  });

  it('charges for exactness in digits, and never stops charging', () => {
    // The denominator is 5^n exactly, so this is log10(5) ≈ 0.699 digits per
    // rotation. Measured, because "about 0.7 digits a step" is the sort of
    // claim this project makes a machine settle — and the first measurement of
    // it said 46 at step 64 because it counted a minus sign as a digit.
    expect(exactDigitsAfter(0)).toBe(1);
    expect(exactDigitsAfter(64)).toBe(45);
    expect(exactDigitsAfter(128)).toBe(90);
    expect(exactDigitsAfter(200)).toBe(140);
    // Strictly growing: the exact reference does not drift and does not fit.
    expect(exactDigitsAfter(201)).toBeGreaterThan(exactDigitsAfter(200));
  });
});

describe('what each machine does with it', () => {
  const asBinary64 = (value: Rational) => {
    const encoded = encodeRational(value);
    return encoded.state.kind === 'finite' ? exactValue(encoded.state.value) : undefined;
  };
  const asQ128 = (value: Rational) => encodeQ128(Q128_128_PRESETS['m']!, value).decoded;

  it('reverses the direction of the drift when the arithmetic rounds too', () => {
    // The finding this experiment exists for, and it was measured before it was
    // written. 200 rotations, same machine, same starting vector:
    //
    //   store   — exact arithmetic, finite registers:  36 above, 164 below
    //   operate — every multiply and add rounds too:  170 above,  30 below
    //
    // The vector shrinks one way and grows the other. That is docs/NUMERICS.md
    // §7's operand-encoding-versus-operation-rounding split showing up as a
    // change of *sign*, not merely of size.
    const stored = runRotation('b64', 'binary64', asBinary64, 200, 'store');
    const operated = runRotation('b64', 'binary64', asBinary64, 200, 'operate');

    expect(stored.drift).toBe('inward');
    expect(operated.drift).toBe('outward');
    expect(stored.stepsTooShort).toBeGreaterThan(stored.stepsTooLong * 3);
    expect(operated.stepsTooLong).toBeGreaterThan(operated.stepsTooShort * 3);
  });

  it('does not pretend the reversal is a law', () => {
    // Q128.128 shrinks under both modes, so the reversal is a fact about
    // binary64 rather than something every finite machine does. A demonstration
    // that only ever showed the machine it works for would be a trick.
    expect(runRotation('q', 'q', asQ128, 200, 'store').drift).toBe('inward');
    expect(runRotation('q', 'q', asQ128, 200, 'operate').drift).toBe('inward');
  });

  it('separates the machines by twenty-odd decades, as everywhere else here', () => {
    const float = runRotation('b64', 'binary64', asBinary64, 200, 'store');
    const fixed = runRotation('q', 'Q128.128 @ m', asQ128, 200, 'store');
    expect(compare(fixed.worstNormError, float.worstNormError)).toBeLessThan(0);
    // 10^-15 against 10^-38.
    expect(compare(float.worstNormError, rational(1n, 10n ** 16n))).toBeGreaterThan(0);
    expect(compare(fixed.worstNormError, rational(1n, 10n ** 36n))).toBeLessThan(0);
  });

  it('reports the step a machine stopped being able to hold the vector', () => {
    // A register that cannot take the next coordinate has said something, so it
    // is a result rather than a throw.
    let calls = 0;
    const givesUp = (value: Rational) => {
      calls += 1;
      return calls > 10 ? undefined : value;
    };
    const run = runRotation('short', 'short', givesUp, 64, 'store');
    expect(run.failedAtStep).toBe(6);
    expect(run.samples).toHaveLength(5);
  });

  it('is exact when the machine is', () => {
    // Anti-vacuity for every assertion above: feed the runner a quantizer that
    // does nothing and the norm error is exactly zero at every step, so the
    // drift the others show is the machines' and not the runner's.
    for (const mode of ['store', 'operate'] as const) {
      const run = runRotation('exact', 'exact', (value) => value, 64, mode);
      expect(
        run.samples.every((sample) => equals(sample.normError, ZERO)),
        mode,
      ).toBe(true);
      expect(equals(run.worstNormError, ZERO), mode).toBe(true);
      expect(run.drift, mode).toBe('balanced');
    }
  });

  it('compounds, because each machine reads back its own answer', () => {
    // Quantizing once at the end is a different and much smaller error. The
    // machine's output has to be the next rotation's input or the experiment is
    // measuring a single rounding.
    const compounded = runRotation('q128', 'q128', asQ128, 64, 'store').worstNormError;
    let exact = START;
    for (let i = 0; i < 64; i += 1) exact = rotateExact(exact);
    const onceAtTheEnd = abs(sub(normSquared({ x: asQ128(exact.x)!, y: asQ128(exact.y)! }), ONE));
    expect(compare(compounded, onceAtTheEnd)).toBeGreaterThan(0);
  });
});
