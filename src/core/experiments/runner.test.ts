import { describe, expect, it } from 'vitest';
import { runExperiment, type ExperimentResult, type MachineResult } from './runner';
import { BUILT_IN_EXPERIMENTS, findExperiment, requireExperiment } from './fixtures';
import { binary64Machine, defaultBoundMachines, exactApply, q128Machine } from './machines';
import { bindMachine } from './machine';
import {
  experimentFromJSON,
  experimentToJSON,
  resolveAccounting,
  resolveCheckpoints,
  stepToJSON,
} from './steps';
import { resultFromJSON, resultToJSON } from './trace';
import { ONE, ZERO, abs, add, equals, lt, lte, mul, rational, sub } from '../rational/rational';
import { toCompactString } from '../rational/json';
import { parseDecimalExact } from '../rational/parse';
import { accumulatorHalfLsb, readAccumulator } from '../representations/q512_512';
import { Q128_128_PRESETS } from '../representations/q128_128';

const r = rational;

function machine(result: ExperimentResult, id: string): MachineResult {
  const found = result.machines.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No machine ${id} in result`);
  return found;
}

/**
 * The Q512.512 meter is a finite machine, so it tracks the exact running total
 * rather than equalling it. Each recorded contribution can cost it up to half
 * an LSB.
 */
function expectMeterTracksExactTotal(entry: MachineResult): void {
  const drift = abs(
    sub(
      readAccumulator(entry.ledger.q512_512SignedAccumulator),
      entry.ledger.cumulativeSignedIntroducedError,
    ),
  );
  const bound = mul(accumulatorHalfLsb(), r(BigInt(entry.ledger.steps)));
  expect(lte(drift, bound)).toBe(true);
}

describe('built-in fixtures', () => {
  it('loads every arithmetic experiment from fixtures/experiments.json', () => {
    const ids = BUILT_IN_EXPERIMENTS.map((experiment) => experiment.id);
    expect(ids).toContain('decimal-0-1-plus-0-2');
    expect(ids).toContain('million-millimeters');
    expect(ids).toContain('large-offset');
    expect(ids).toContain('thirds');
  });

  it('leaves the non-step fixtures to their own modules', () => {
    expect(findExperiment('floating-origin')).toBeUndefined();
    expect(findExperiment('q128-base-unit-comparison')).toBeUndefined();
  });

  it('round-trips a definition through JSON', () => {
    const original = requireExperiment('million-millimeters');
    const restored = experimentFromJSON(JSON.parse(JSON.stringify(experimentToJSON(original))));
    expect(restored).toEqual(original);
    // Including the trace policy, which is what makes the run compact.
    expect(stepToJSON(restored.steps[1]!)).toEqual(stepToJSON(original.steps[1]!));
  });
});

describe('0.1 + 0.2', () => {
  const result = runExperiment(requireExperiment('decimal-0-1-plus-0-2'));

  it('gives the exact reference exactly three tenths', () => {
    expect(result.exactFinal).toEqual(r(3n, 10n));
  });

  it('shows binary64 disagreeing, and says by how much', () => {
    const b64 = machine(result, 'binary64');
    expect(equals(b64.final.decoded!, r(3n, 10n))).toBe(false);
    expect(b64.final.signedDivergence).not.toEqual(ZERO);

    // Both operands had to be encoded, and the sum rounded again on top.
    expect(b64.ledger.cumulativeAbsoluteOperandEncodingContribution).not.toEqual(ZERO);
    expect(b64.ledger.cumulativeAbsoluteOperationRoundingError).not.toEqual(ZERO);
  });

  it('shows the fixed-point machines quantizing the operands but adding exactly', () => {
    for (const id of ['q128.128@m', 'planck-int256']) {
      const entry = machine(result, id);
      expect(entry.ledger.cumulativeAbsoluteOperandEncodingContribution).not.toEqual(ZERO);
      expect(entry.ledger.cumulativeAbsoluteOperationRoundingError).toEqual(ZERO);
    }
  });

  it('keeps every machine independent', () => {
    const divergences = result.machines.map((entry) =>
      toCompactString(entry.final.signedDivergence!),
    );
    // Three machines, three different answers. None was corrected using another.
    expect(new Set(divergences).size).toBe(3);
  });
});

describe('three thirds', () => {
  const result = runExperiment(requireExperiment('thirds'));

  it('sums to exactly one in the exact reference', () => {
    expect(result.exactFinal).toEqual(ONE);
  });

  it('leaves both fixed-point machines short or long of one metre', () => {
    for (const id of ['q128.128@m', 'planck-int256']) {
      const entry = machine(result, id);
      expect(equals(entry.final.decoded!, ONE)).toBe(false);
      expect(entry.final.signedDivergence).not.toEqual(ZERO);
    }
  });

  it('lands binary64 exactly on one, by a tie that rounds the right way', () => {
    // A result worth keeping rather than explaining away. fl(1/3) doubled is
    // exact, and the third addition lands exactly halfway between 1 - 2^-53 and
    // 1. Ties-to-even picks 1, whose significand is even. Floating point is not
    // simply "worse" — it is differently convenient.
    const b64 = machine(result, 'binary64');
    expect(b64.final.decoded).toEqual(ONE);
    expect(b64.final.signedDivergence).toEqual(ZERO);

    // It got there through error, not through accuracy. Three operand
    // encodings and a final rounding all happened and all cancelled — which is
    // exactly why docs/NUMERICS.md §6 refuses to keep only a signed total.
    expect(b64.ledger.cumulativeSignedIntroducedError).toEqual(ZERO);
    expect(b64.ledger.cumulativeAbsoluteOperandEncodingContribution).not.toEqual(ZERO);
    expect(b64.ledger.cumulativeAbsoluteOperationRoundingError).not.toEqual(ZERO);
  });
});

describe('the large offset', () => {
  const result = runExperiment(requireExperiment('large-offset'));

  it('returns exactly one millimetre in the exact reference', () => {
    expect(result.exactFinal).toEqual(r(1n, 1000n));
  });

  it('loses the millimetre in binary64', () => {
    const b64 = machine(result, 'binary64');
    expect(b64.final.decoded).toEqual(ZERO);
    expect(b64.final.signedDivergence).toEqual(r(-1n, 1000n));
  });

  it('keeps the millimetre in fixed point, because its resolution is constant', () => {
    const q128 = machine(result, 'q128.128@m');
    const divergence = abs(q128.final.signedDivergence!);
    // Not exact — a millimetre is not on a binary grid — but not lost either.
    expect(lt(divergence, parseDecimalExact('1e-30'))).toBe(true);
  });

  it('records the loss as rounding error rather than letting it vanish', () => {
    const b64 = machine(result, 'binary64');
    expect(b64.ledger.cumulativeAbsoluteOperationRoundingError).not.toEqual(ZERO);
  });
});

describe('a million millimetres', () => {
  const result = runExperiment(requireExperiment('million-millimeters'));

  it('reaches exactly 1000 m in the exact reference', () => {
    expect(result.exactFinal).toEqual(r(1000n));
  });

  it('performs one million real machine operations per machine', () => {
    // The acceptance criterion from docs/IMPLEMENTATION_PLAN.md: every addition
    // actually happens. One `set` plus 1,000,000 adds.
    for (const entry of result.machines) {
      expect(entry.operations).toBe(1_000_001);
    }
    expect(result.totalOperations).toBe(3_000_003);
  });

  it('stores a compact trace rather than a million records', () => {
    // The fixture asks for first 5, last 5 and seven checkpoints, plus the
    // `set` step's own sample.
    expect(result.samples.length).toBeLessThan(30);
    expect(result.samples.at(-1)?.iteration).toBe(1_000_000);
  });

  it('accounts a long repeat per interval', () => {
    expect(result.accounting[1]).toBe('interval');
  });

  it('drifts in binary64 and says so', () => {
    const b64 = machine(result, 'binary64');
    expect(equals(b64.final.decoded!, r(1000n))).toBe(false);
    expect(b64.final.signedDivergence).not.toEqual(ZERO);
    // Interval accounting cannot separate rounding errors that cancelled inside
    // an interval, so the absolute total is disclosed as a lower bound.
    expect(b64.absoluteRoundingIsLowerBound).toBe(true);
  });

  it('drifts in fixed point by exactly a million operand encodings', () => {
    const q128 = machine(result, 'q128.128@m');
    // Fixed-point addition is exact, so all of the divergence is operand
    // encoding — and the absolute total is not a lower bound.
    expect(q128.ledger.cumulativeAbsoluteOperationRoundingError).toEqual(ZERO);
    expect(q128.absoluteRoundingIsLowerBound).toBe(false);
    expect(q128.ledger.cumulativeAbsoluteOperandEncodingContribution).toEqual(
      abs(q128.final.signedDivergence!),
    );
  });

  it('feeds each machine its own error meter and no other', () => {
    for (const entry of result.machines) {
      expectMeterTracksExactTotal(entry);
    }
  });

  it('is deterministic', () => {
    const again = runExperiment(requireExperiment('million-millimeters'));
    expect(again.exactFinal).toEqual(result.exactFinal);
    for (const entry of again.machines) {
      expect(entry.final.decoded).toEqual(machine(result, entry.id).final.decoded);
    }
  });
});

describe('interval accounting equals per-iteration accounting', () => {
  // The claim that makes a compact trace legitimate. Same experiment, same
  // machines, both accounting modes — the ledgers must agree everywhere the
  // signed decomposition is defined.
  const definition = experimentFromJSON({
    id: 'accounting-equivalence',
    name: 'accounting equivalence',
    unit: 'm',
    steps: [
      { op: 'set', value: { numerator: '0', denominator: '1' } },
      {
        op: 'repeat',
        count: 500,
        step: { op: 'add', value: { numerator: '1', denominator: '1000' } },
        trace: { checkpoints: [100, 250, 500] },
      },
    ],
  });

  const perIteration = runExperiment({
    ...definition,
    steps: [
      definition.steps[0]!,
      {
        ...definition.steps[1]!,
        trace: { checkpoints: [100, 250, 500], accounting: 'per-iteration' },
      },
    ],
  } as typeof definition);

  const interval = runExperiment({
    ...definition,
    steps: [
      definition.steps[0]!,
      { ...definition.steps[1]!, trace: { checkpoints: [100, 250, 500], accounting: 'interval' } },
    ],
  } as typeof definition);

  it('uses the two modes it says it does', () => {
    expect(perIteration.accounting[1]).toBe('per-iteration');
    expect(interval.accounting[1]).toBe('interval');
  });

  it('agrees on the final state and divergence for every machine', () => {
    for (const entry of interval.machines) {
      const other = machine(perIteration, entry.id);
      expect(entry.final.decoded).toEqual(other.final.decoded);
      expect(entry.final.signedDivergence).toEqual(other.final.signedDivergence);
    }
  });

  it('agrees on the signed introduced error for every machine', () => {
    for (const entry of interval.machines) {
      const other = machine(perIteration, entry.id);
      expect(entry.ledger.cumulativeSignedIntroducedError).toEqual(
        other.ledger.cumulativeSignedIntroducedError,
      );
    }
  });

  it('agrees on absolute totals where the operation is exact', () => {
    for (const id of ['q128.128@m', 'planck-int256']) {
      const entry = machine(interval, id);
      const other = machine(perIteration, id);
      expect(entry.ledger.cumulativeAbsoluteOperandEncodingContribution).toEqual(
        other.ledger.cumulativeAbsoluteOperandEncodingContribution,
      );
      expect(entry.ledger.cumulativeAbsoluteOperationRoundingError).toEqual(
        other.ledger.cumulativeAbsoluteOperationRoundingError,
      );
      expect(entry.absoluteRoundingIsLowerBound).toBe(false);
    }
  });

  it('discloses that the binary64 absolute rounding total is only a lower bound', () => {
    const entry = machine(interval, 'binary64');
    const other = machine(perIteration, 'binary64');
    expect(entry.absoluteRoundingIsLowerBound).toBe(true);
    expect(other.absoluteRoundingIsLowerBound).toBe(false);
    // The disclosed figure never exceeds the true per-iteration total.
    const disclosed = entry.ledger.cumulativeAbsoluteOperationRoundingError;
    const truth = other.ledger.cumulativeAbsoluteOperationRoundingError;
    expect(lt(truth, disclosed)).toBe(false);
  });
});

describe('scalar operations', () => {
  it('runs (1/10) × 10 through every machine', () => {
    const definition = experimentFromJSON({
      id: 'tenth-times-ten',
      name: '(1/10) x 10',
      unit: 'm',
      steps: [
        { op: 'set', value: { numerator: '1', denominator: '10' } },
        { op: 'mul', value: { numerator: '10', denominator: '1' } },
      ],
    });
    const result = runExperiment(definition);

    expect(result.exactFinal).toEqual(ONE);
    // binary64 gets exactly 1 back here — the rounding happens to undo itself.
    expect(machine(result, 'binary64').final.decoded).toEqual(ONE);
    // The fixed-point machines do not, because 1/10 was never on their grid.
    expect(equals(machine(result, 'q128.128@m').final.decoded!, ONE)).toBe(false);
  });

  it('always accounts a repeated scalar step per iteration', () => {
    // Interval accounting is only valid for add/sub, so a repeated `mul` must
    // fall back regardless of length.
    const repeated = {
      op: 'repeat' as const,
      count: 50_000,
      step: { op: 'mul' as const, value: ONE },
    };
    expect(resolveAccounting(repeated)).toBe('per-iteration');
  });
});

describe('trace policy', () => {
  it('resolves first, last and explicit checkpoints', () => {
    expect(resolveCheckpoints(10, { first: 2, last: 2 })).toEqual([1, 2, 9, 10]);
    expect(resolveCheckpoints(10, { checkpoints: [5] })).toEqual([5, 10]);
    // Always ends on the final iteration.
    expect(resolveCheckpoints(10)).toEqual([10]);
    expect(resolveCheckpoints(0)).toEqual([]);
  });

  it('ignores checkpoints outside the run', () => {
    expect(resolveCheckpoints(5, { checkpoints: [0, 3, 99] })).toEqual([3, 5]);
  });
});

describe('progress and cancellation', () => {
  const definition = experimentFromJSON({
    id: 'progress',
    name: 'progress',
    unit: 'm',
    steps: [
      {
        op: 'repeat',
        count: 5000,
        step: { op: 'add', value: { numerator: '1', denominator: '1000' } },
      },
    ],
  });

  it('reports chunked progress', () => {
    const seen: number[] = [];
    runExperiment(definition, { chunkSize: 1000, onProgress: (p) => seen.push(p.iteration) });
    expect(seen).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it('stops cooperatively and still accounts the work it did', () => {
    const signal = { aborted: false };
    let iterations = 0;
    const result = runExperiment(definition, {
      chunkSize: 100,
      signal,
      onProgress: (p) => {
        iterations = p.iteration;
        if (p.iteration >= 300) signal.aborted = true;
      },
    });

    expect(result.aborted).toBe(true);
    expect(iterations).toBe(300);
    for (const entry of result.machines) {
      expect(entry.operations).toBe(300);
      expect(entry.ledger.steps).toBeGreaterThan(0);
    }
  });
});

describe('machine independence and overflow', () => {
  it('never lets one machine read another', () => {
    // A run with only binary64 must produce exactly the same binary64 result as
    // a run with all three machines beside it.
    const definition = requireExperiment('large-offset');
    const alone = runExperiment(definition, { machines: [bindMachine(binary64Machine())] });
    const together = runExperiment(definition);

    expect(alone.machines[0]?.final.decoded).toEqual(machine(together, 'binary64').final.decoded);
    expect(alone.machines[0]?.ledger.cumulativeSignedIntroducedError).toEqual(
      machine(together, 'binary64').ledger.cumulativeSignedIntroducedError,
    );
  });

  it('reports overflow as an event and stops that machine, not the run', () => {
    const definition = experimentFromJSON({
      id: 'overflow',
      name: 'overflow',
      unit: 'm',
      steps: [{ op: 'set', value: { numerator: '1', denominator: '1' } }],
    });
    // Q128.128 @ mm cannot hold 1e40 m; binary64 can.
    const huge = experimentFromJSON({
      id: 'overflow',
      name: 'overflow',
      unit: 'm',
      steps: [{ op: 'set', value: { numerator: '1' + '0'.repeat(40), denominator: '1' } }],
    });

    const result = runExperiment(huge, {
      machines: [bindMachine(q128Machine(Q128_128_PRESETS.mm)), bindMachine(binary64Machine())],
    });

    const fixed = machine(result, 'q128.128@mm');
    expect(fixed.events.some((event) => event.kind === 'overflow')).toBe(true);
    expect(fixed.final.decoded).toEqual(ZERO);

    const b64 = machine(result, 'binary64');
    expect(b64.events).toEqual([]);
    expect(runExperiment(definition).aborted).toBe(false);
  });
});

describe('trace serialization', () => {
  it('round-trips a result without numerical loss', () => {
    const result = runExperiment(requireExperiment('large-offset'));
    const restored = resultFromJSON(JSON.parse(JSON.stringify(resultToJSON(result))));

    expect(restored.exactFinal).toEqual(result.exactFinal);
    expect(restored.samples).toEqual(result.samples);
    expect(restored.totalOperations).toBe(result.totalOperations);
    expect(restored.accounting).toEqual(result.accounting);

    for (const entry of restored.machines) {
      const original = machine(result, entry.id);
      expect(entry.final).toEqual(original.final);
      expect(entry.ledger).toEqual(original.ledger);
      expect(entry.rawState).toBe(original.rawState);
    }
  });

  it('round-trips a compact million-step trace', () => {
    const result = runExperiment(requireExperiment('million-millimeters'));
    const json = JSON.stringify(resultToJSON(result));
    // A compact trace, not a million records.
    expect(json.length).toBeLessThan(200_000);
    expect(resultFromJSON(JSON.parse(json)).exactFinal).toEqual(r(1000n));
  });

  it('rejects an unknown schema version', () => {
    const json = resultToJSON(runExperiment(requireExperiment('thirds')));
    expect(() => resultFromJSON({ ...json, version: 99 })).toThrow();
  });
});

describe('exactApply', () => {
  it('is the unbounded reference, with no rounding anywhere', () => {
    expect(exactApply(ZERO, 'set', r(1n, 3n))).toEqual(r(1n, 3n));
    expect(exactApply(r(1n, 3n), 'add', r(2n, 3n))).toEqual(ONE);
    expect(exactApply(ONE, 'sub', r(1n, 3n))).toEqual(r(2n, 3n));
    expect(exactApply(r(1n, 10n), 'mul', r(10n))).toEqual(ONE);
    expect(exactApply(ONE, 'div', r(3n))).toEqual(r(1n, 3n));
  });
});

describe('default machine set', () => {
  it('binds fresh state on every call', () => {
    const first = defaultBoundMachines();
    const second = defaultBoundMachines();
    first[0]?.apply({ op: 'set', value: ONE });
    expect(second[0]?.decode()).toEqual(ZERO);
  });

  it('is the three rows the UI spec asks for', () => {
    expect(defaultBoundMachines().map((entry) => entry.id)).toEqual([
      'planck-int256',
      'q128.128@m',
      'binary64',
    ]);
  });
});

describe('the exact reference is never used to repair a machine', () => {
  it('leaves each machine exactly where its own arithmetic put it', () => {
    // Re-run the millimetre addition by hand against one machine and check the
    // runner reached the same place.
    const result = runExperiment(requireExperiment('thirds'));
    const bound = bindMachine(q128Machine());
    const third = r(1n, 3n);
    bound.apply({ op: 'set', value: ZERO });
    for (let i = 0; i < 3; i += 1) bound.apply({ op: 'add', value: third });

    expect(machine(result, 'q128.128@m').final.decoded).toEqual(bound.decode());
    expect(equals(bound.decode()!, add(add(third, third), third))).toBe(false);
  });

  it('keeps divergence equal to decoded minus exact, by construction', () => {
    const result = runExperiment(requireExperiment('large-offset'));
    for (const entry of result.machines) {
      expect(entry.final.signedDivergence).toEqual(sub(entry.final.decoded!, result.exactFinal));
    }
  });
});

describe('unit handling', () => {
  it('interprets operands in the experiment unit', () => {
    const inMillimetres = experimentFromJSON({
      id: 'mm-unit',
      name: 'mm unit',
      unit: 'mm',
      steps: [{ op: 'set', value: { numerator: '1', denominator: '1' } }],
    });
    // 1 mm expressed in canonical SI metres.
    expect(runExperiment(inMillimetres).exactFinal).toEqual(r(1n, 1000n));
  });

  it('leaves scalars dimensionless', () => {
    const scaled = experimentFromJSON({
      id: 'mm-scalar',
      name: 'mm scalar',
      unit: 'mm',
      steps: [
        { op: 'set', value: { numerator: '1', denominator: '1' } },
        { op: 'mul', value: { numerator: '1000', denominator: '1' } },
      ],
    });
    expect(runExperiment(scaled).exactFinal).toEqual(ONE);
  });
});

describe('the Q512.512 meter is finite, even here', () => {
  it('tracks the exact total to within its own resolution, but not exactly', () => {
    const result = runExperiment(requireExperiment('thirds'));
    for (const entry of result.machines) {
      expectMeterTracksExactTotal(entry);
    }

    // And it really is only tracking. A quantization error like k/2^128 - 1/1000
    // has a factor of five in its denominator, so it is not representable in a
    // binary fixed-point meter at any width.
    const q128 = machine(result, 'q128.128@m');
    expect(readAccumulator(q128.ledger.q512_512SignedAccumulator)).not.toEqual(
      q128.ledger.cumulativeSignedIntroducedError,
    );
  });

  it('tracks the absolute meter separately from the signed one', () => {
    const result = runExperiment(requireExperiment('decimal-0-1-plus-0-2'));
    const b64 = machine(result, 'binary64');
    const signed = readAccumulator(b64.ledger.q512_512SignedAccumulator);
    const absolute = readAccumulator(b64.ledger.q512_512AbsoluteAccumulator);
    expect(lt(abs(signed), absolute) || equals(abs(signed), absolute)).toBe(true);
  });
});

describe('mul does not pretend the operand was free', () => {
  it('charges binary64 for encoding the scalar', () => {
    const definition = experimentFromJSON({
      id: 'scalar-encoding',
      name: 'scalar encoding',
      unit: 'm',
      steps: [
        { op: 'set', value: { numerator: '1', denominator: '1' } },
        { op: 'mul', value: { numerator: '1', denominator: '10' } },
      ],
    });
    const result = runExperiment(definition);
    const b64 = machine(result, 'binary64');
    // 1/10 is not representable, so encoding the scalar costs something.
    expect(b64.ledger.cumulativeAbsoluteOperandEncodingContribution).not.toEqual(ZERO);

    // Fixed point applies the exact scalar and requantizes, so all of its error
    // is operation rounding instead.
    const q128 = machine(result, 'q128.128@m');
    expect(q128.ledger.exactSignedOperandEncodingContribution).toEqual(ZERO);
    expect(q128.ledger.exactSignedOperationRoundingError).not.toEqual(ZERO);
  });
});

describe('sample shape', () => {
  it('samples every atomic step and only checkpointed iterations', () => {
    const result = runExperiment(requireExperiment('large-offset'));
    expect(result.samples).toHaveLength(4);
    expect(result.samples.map((sample) => sample.stepIndex)).toEqual([0, 1, 2, 3]);
    expect(result.samples.every((sample) => sample.iteration === undefined)).toBe(true);
  });

  it('carries every machine into each sample', () => {
    const result = runExperiment(requireExperiment('thirds'));
    for (const sample of result.samples) {
      expect(Object.keys(sample.machines).sort()).toEqual([
        'binary64',
        'planck-int256',
        'q128.128@m',
      ]);
    }
  });

  it('keeps the exact reference in the sample so divergence can be re-derived', () => {
    const result = runExperiment(requireExperiment('thirds'));
    const last = result.samples.at(-1)!;
    for (const [, entry] of Object.entries(last.machines)) {
      expect(entry.signedDivergence).toEqual(sub(entry.decoded!, last.exact));
    }
    expect(last.exact).toEqual(result.exactFinal);
  });
});

describe('a repeat with no trace policy still ends somewhere', () => {
  it('always samples the final iteration', () => {
    const definition = experimentFromJSON({
      id: 'bare-repeat',
      name: 'bare repeat',
      unit: 'm',
      steps: [
        {
          op: 'repeat',
          count: 7,
          step: { op: 'add', value: { numerator: '1', denominator: '2' } },
        },
      ],
    });
    const result = runExperiment(definition);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.iteration).toBe(7);
    expect(result.exactFinal).toEqual(mul(r(7n), r(1n, 2n)));
    // Halves are exactly representable everywhere except the Planck grid.
    expect(machine(result, 'q128.128@m').final.signedDivergence).toEqual(ZERO);
  });
});
