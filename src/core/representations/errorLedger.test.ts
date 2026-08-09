import { describe, expect, it } from 'vitest';
import {
  type ErrorContribution,
  createErrorLedger,
  decompositionResidual,
  recordContribution,
} from './errorLedger';
import { readAccumulator } from './q512_512';
import { type Rational, ZERO, add, pow2, rational, sub } from '../rational/rational';

const r = rational;

function contribution(parts: {
  inherited?: Rational;
  operand?: Rational;
  rounding?: Rational;
}): ErrorContribution {
  const inheritedPropagation = parts.inherited ?? ZERO;
  const operandEncodingContribution = parts.operand ?? ZERO;
  const operationRoundingError = parts.rounding ?? ZERO;
  return {
    inheritedPropagation,
    operandEncodingContribution,
    operationRoundingError,
    signedDivergence: add(
      add(inheritedPropagation, operandEncodingContribution),
      operationRoundingError,
    ),
  };
}

describe('a fresh ledger', () => {
  it('starts at exact zero everywhere', () => {
    const ledger = createErrorLedger();
    expect(ledger.currentSignedDivergence).toEqual(ZERO);
    expect(ledger.cumulativeAbsoluteOperandEncodingContribution).toEqual(ZERO);
    expect(ledger.cumulativeAbsoluteOperationRoundingError).toEqual(ZERO);
    expect(readAccumulator(ledger.q512_512SignedAccumulator)).toEqual(ZERO);
    expect(readAccumulator(ledger.q512_512AbsoluteAccumulator)).toEqual(ZERO);
    expect(ledger.steps).toBe(0);
    expect(ledger.meterEvents).toEqual([]);
  });

  it('has no raw operand delta until one is recorded', () => {
    expect(createErrorLedger().exactRawOperandEncodingDelta).toBeUndefined();
  });
});

describe('recording contributions', () => {
  it('keeps operand encoding separate from operation rounding', () => {
    const ledger = recordContribution(
      createErrorLedger(),
      contribution({ operand: r(1n, 8n), rounding: r(-1n, 16n) }),
    );

    expect(ledger.exactSignedOperandEncodingContribution).toEqual(r(1n, 8n));
    expect(ledger.exactSignedOperationRoundingError).toEqual(r(-1n, 16n));
    expect(ledger.exactAbsoluteOperationRoundingError).toEqual(r(1n, 16n));
    expect(ledger.currentSignedDivergence).toEqual(r(1n, 16n));
    expect(ledger.steps).toBe(1);
  });

  it('is immutable — recording returns a new ledger', () => {
    const before = createErrorLedger();
    const after = recordContribution(before, contribution({ operand: r(1n, 4n) }));
    expect(before.steps).toBe(0);
    expect(after.steps).toBe(1);
    expect(before.cumulativeSignedIntroducedError).toEqual(ZERO);
  });

  it('accumulates absolute totals by category, so cancellation cannot hide error', () => {
    let ledger = createErrorLedger();
    ledger = recordContribution(ledger, contribution({ operand: r(1n, 4n) }));
    ledger = recordContribution(ledger, contribution({ operand: r(-1n, 4n) }));

    // Signed total cancelled to zero...
    expect(ledger.cumulativeSignedIntroducedError).toEqual(ZERO);
    // ...but half of a unit of error genuinely happened.
    expect(ledger.cumulativeAbsoluteOperandEncodingContribution).toEqual(r(1n, 2n));
    expect(readAccumulator(ledger.q512_512AbsoluteAccumulator)).toEqual(r(1n, 2n));
    expect(readAccumulator(ledger.q512_512SignedAccumulator)).toEqual(ZERO);
  });

  it('does not feed inherited divergence into the meters twice', () => {
    // Step 1 introduces 1/4. Step 2 introduces nothing new but inherits it.
    let ledger = recordContribution(createErrorLedger(), contribution({ operand: r(1n, 4n) }));
    ledger = recordContribution(ledger, contribution({ inherited: r(1n, 4n) }));

    expect(ledger.currentSignedDivergence).toEqual(r(1n, 4n));
    expect(ledger.currentSignedInheritedPropagation).toEqual(r(1n, 4n));
    // The meter still reads one quarter, not one half.
    expect(readAccumulator(ledger.q512_512SignedAccumulator)).toEqual(r(1n, 4n));
  });

  it('records the raw operand delta only when supplied', () => {
    const withDelta = recordContribution(createErrorLedger(), {
      ...contribution({ operand: r(1n, 8n) }),
      rawOperandEncodingDelta: r(1n, 8n),
    });
    expect(withDelta.exactRawOperandEncodingDelta).toEqual(r(1n, 8n));
  });

  it('keeps the exact total alongside the finite meter so the meter can be audited', () => {
    // Contributions below 2^-512 vanish into the meter but not into exact truth.
    const tiny = pow2(-520);
    let ledger = createErrorLedger();
    for (let i = 0; i < 4; i += 1) {
      ledger = recordContribution(ledger, contribution({ rounding: tiny }));
    }

    expect(ledger.cumulativeSignedIntroducedError).toEqual(
      rational(4n * tiny.numerator, tiny.denominator),
    );
    expect(readAccumulator(ledger.q512_512SignedAccumulator)).toEqual(ZERO);
  });

  it('reports meter saturation as an event', () => {
    const enormous = rational(2n ** 511n);
    let ledger = createErrorLedger();
    for (let i = 0; i < 3; i += 1) {
      ledger = recordContribution(ledger, contribution({ rounding: enormous }));
    }
    expect(ledger.meterEvents.length).toBeGreaterThan(0);
    expect(ledger.meterEvents[0]?.direction).toBe('above');
  });
});

describe('decompositionResidual', () => {
  it('is zero when the parts add up, as docs/NUMERICS.md §7 requires', () => {
    expect(
      decompositionResidual(contribution({ inherited: r(1n, 3n), operand: r(1n, 5n) })),
    ).toEqual(ZERO);
  });

  it('is non-zero when a decomposition is wrong', () => {
    const broken: ErrorContribution = {
      ...contribution({ operand: r(1n, 4n) }),
      signedDivergence: r(1n, 2n),
    };
    expect(decompositionResidual(broken)).toEqual(r(1n, 4n));
    expect(sub(broken.signedDivergence, r(1n, 4n))).toEqual(r(1n, 4n));
  });
});
