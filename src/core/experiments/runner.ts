/**
 * The experiment runner.
 *
 * Runs one sequence of operations against the exact reference and every
 * simulated machine at once, and derives the docs/NUMERICS.md §7 error
 * decomposition for each. The decomposition lives here and nowhere else, so a
 * machine cannot quietly redefine what its own error means, and no machine ever
 * sees another's state.
 *
 * Two invariants the code enforces rather than assumes:
 *
 * - Every iteration of a `repeat` performs a real machine operation. The trace
 *   is compact; the arithmetic never is (docs/NUMERICS.md §11).
 * - The §7 identity holds on every accounted step, checked with
 *   `decompositionResidual`. A decomposition bug cannot hide behind
 *   plausible-looking numbers.
 */

import { type Rational, ZERO, add, isZero, mul, rational, sub } from '../rational/rational';
import { requireUnit } from '../units/units';
import {
  type ErrorContribution,
  type ErrorLedger,
  createErrorLedger,
  decompositionResidual,
  recordContribution,
} from '../representations/errorLedger';
import {
  type BoundMachine,
  type MachineDescription,
  type MachineEvent,
  MachineOperationError,
} from './machine';
import { defaultBoundMachines, exactApply } from './machines';
import {
  type AccountingMode,
  type AtomicExperimentStep,
  type AtomicOp,
  type ExperimentDefinition,
  type RepeatExperimentStep,
  ExperimentError,
  isRepeatStep,
  resolveAccounting,
  resolveCheckpoints,
} from './steps';

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

export interface MachineSample {
  /** Exact value the machine holds. Absent when it holds no rational. */
  decoded?: Rational;
  /** `decoded - exact`. Absent when the machine holds no rational. */
  signedDivergence?: Rational;
}

export interface TraceSample {
  /** Index into `definition.steps`. */
  stepIndex: number;
  /** 1-based iteration within a repeat; absent for atomic steps. */
  iteration?: number;
  exact: Rational;
  machines: Record<string, MachineSample>;
}

export interface MachineResult {
  id: string;
  label: string;
  description: MachineDescription;
  ledger: ErrorLedger;
  final: MachineSample;
  rawState?: string;
  events: readonly MachineEvent[];
  /** Real machine operations performed. */
  operations: number;
  /**
   * True when a long repeat was accounted per interval and this machine's
   * operations are not exact, so `cumulativeAbsoluteOperationRoundingError` is
   * a lower bound: rounding errors that cancelled inside an interval cannot be
   * recovered from its endpoints. Every other figure remains exact.
   */
  absoluteRoundingIsLowerBound: boolean;
}

export interface ExperimentResult {
  experimentId: string;
  unit: string;
  /** Exact reference value at the end, in canonical SI units. */
  exactFinal: Rational;
  machines: readonly MachineResult[];
  samples: readonly TraceSample[];
  /** Accounting mode actually used, keyed by repeat step index. */
  accounting: Readonly<Record<number, AccountingMode>>;
  /** Total real machine operations across all machines. */
  totalOperations: number;
  aborted: boolean;
}

export interface RunProgress {
  stepIndex: number;
  iteration: number;
  count: number;
}

export interface RunOptions {
  /** Defaults to Planck, Q128.128 @ m and binary64. */
  machines?: BoundMachine[];
  /** Called every `chunkSize` iterations of a long repeat. */
  onProgress?: (progress: RunProgress) => void;
  chunkSize?: number;
  /**
   * Cooperative cancellation. A plain object rather than `AbortSignal` so the
   * numeric core stays free of DOM types and can move into a Worker unchanged.
   */
  signal?: { readonly aborted: boolean };
}

const DEFAULT_CHUNK_SIZE = 50_000;

/* -------------------------------------------------------------------------- */
/* Per-machine run state                                                       */
/* -------------------------------------------------------------------------- */

interface MachineRun {
  machine: BoundMachine;
  ledger: ErrorLedger;
  events: MachineEvent[];
  operations: number;
  absoluteRoundingIsLowerBound: boolean;
  /** The machine refused an operation; stop asking it to do more. */
  halted: boolean;
  /** The machine no longer holds a rational (±Infinity, NaN); stop accounting. */
  unaccountable: boolean;
}

/**
 * `op` applied `count` times with the same operand, exactly.
 *
 * This is the closed form of the repeated *reference* operation, used only to
 * describe what the machine's error should be measured against. It never stands
 * in for a machine's work — and `resolveAccounting` only permits interval
 * accounting for `add`/`sub`, where this form is exactly equal to iterating.
 */
function exactApplyRepeated(
  previous: Rational,
  op: AtomicOp,
  operand: Rational,
  count: bigint,
): Rational {
  if (count === 1n) return exactApply(previous, op, operand);
  if (op === 'add') return add(previous, mul(operand, rational(count)));
  if (op === 'sub') return sub(previous, mul(operand, rational(count)));
  throw new ExperimentError(`Interval accounting is not valid for ${op}`);
}

/**
 * Fold one accounted step's §7 decomposition into a machine's ledger.
 *
 * `count` is 1 for an atomic step, or the interval length when a long repeat is
 * accounted per interval. The identity is verified before anything is recorded.
 */
function account(
  run: MachineRun,
  op: AtomicOp,
  operand: Rational,
  representedOperand: Rational,
  previousDecoded: Rational,
  newDecoded: Rational,
  exactNew: Rational,
  count: bigint,
): void {
  // What the machine's own prior state plus the *exact* operand would give.
  const baseline =
    op === 'set' ? exactNew : exactApplyRepeated(previousDecoded, op, operand, count);
  // The same, but with the operand as the machine actually represented it.
  const ideal =
    op === 'set'
      ? representedOperand
      : exactApplyRepeated(previousDecoded, op, representedOperand, count);

  const rawDelta = sub(representedOperand, operand);
  const contribution: ErrorContribution = {
    signedDivergence: sub(newDecoded, exactNew),
    inheritedPropagation: sub(baseline, exactNew),
    operandEncodingContribution: sub(ideal, baseline),
    operationRoundingError: sub(newDecoded, ideal),
    rawOperandEncodingDelta: count === 1n ? rawDelta : mul(rawDelta, rational(count)),
  };

  const residual = decompositionResidual(contribution);
  if (!isZero(residual)) {
    throw new ExperimentError(
      `Error decomposition does not balance for ${run.machine.id} (${op}): residual ` +
        `${residual.numerator}/${residual.denominator}`,
    );
  }
  run.ledger = recordContribution(run.ledger, contribution);
}

/* -------------------------------------------------------------------------- */
/* The runner                                                                  */
/* -------------------------------------------------------------------------- */

export function runExperiment(
  definition: ExperimentDefinition,
  options: RunOptions = {},
): ExperimentResult {
  const unit = requireUnit(definition.unit);
  /** `mul` and `div` take a dimensionless scalar; everything else is a quantity. */
  const canonicalOperand = (step: AtomicExperimentStep): Rational =>
    step.op === 'mul' || step.op === 'div' ? step.value : mul(step.value, unit.toCanonical);

  const runs: MachineRun[] = (options.machines ?? defaultBoundMachines()).map((machine) => ({
    machine,
    ledger: createErrorLedger(),
    events: [],
    operations: 0,
    absoluteRoundingIsLowerBound: false,
    halted: false,
    unaccountable: false,
  }));

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const samples: TraceSample[] = [];
  const accounting: Record<number, AccountingMode> = {};
  let exact = ZERO;
  let aborted = false;

  const sample = (stepIndex: number, iteration?: number): void => {
    const machines: Record<string, MachineSample> = {};
    for (const run of runs) {
      const decoded = run.machine.decode();
      machines[run.machine.id] =
        decoded === undefined ? {} : { decoded, signedDivergence: sub(decoded, exact) };
    }
    samples.push({
      stepIndex,
      ...(iteration === undefined ? {} : { iteration }),
      exact,
      machines,
    });
  };

  const runAtomic = (step: AtomicExperimentStep): void => {
    const operand = canonicalOperand(step);
    const canonicalStep: AtomicExperimentStep = { op: step.op, value: operand };
    exact = exactApply(exact, step.op, operand);

    for (const run of runs) {
      if (run.halted) continue;
      const previousDecoded = run.machine.decode();
      const result = run.machine.apply(canonicalStep);
      run.operations += 1;
      run.events.push(...result.events);

      if (result.events.some((event) => event.kind === 'overflow')) {
        // The write was refused, so the state is untouched and there is nothing
        // to account for. The event is the result.
        continue;
      }
      if (result.decoded === undefined) {
        run.unaccountable = true;
        continue;
      }
      if (run.unaccountable || previousDecoded === undefined) continue;

      account(
        run,
        step.op,
        operand,
        result.representedOperand,
        previousDecoded,
        result.decoded,
        exact,
        1n,
      );
    }
  };

  const runRepeat = (step: RepeatExperimentStep, stepIndex: number): void => {
    const mode = resolveAccounting(step);
    accounting[stepIndex] = mode;

    const atomic = step.step;
    const operand = canonicalOperand(atomic);
    const canonicalStep: AtomicExperimentStep = { op: atomic.op, value: operand };
    const checkpoints = new Set(resolveCheckpoints(step.count, step.trace));

    const plans = runs.map((run) => ({
      run,
      repeat: run.machine.beginRepeat(canonicalStep),
      /** Decoded value at the start of the interval currently being accounted. */
      intervalStart: run.machine.decode(),
      intervalLength: 0n,
    }));

    const settle = (): void => {
      for (const entry of plans) {
        const { run } = entry;
        if (run.unaccountable || entry.intervalStart === undefined || entry.intervalLength === 0n) {
          continue;
        }
        const decoded = run.machine.decode();
        if (decoded === undefined) {
          run.unaccountable = true;
          continue;
        }
        account(
          run,
          atomic.op,
          operand,
          entry.repeat.representedOperand,
          entry.intervalStart,
          decoded,
          exact,
          entry.intervalLength,
        );
        if (entry.intervalLength > 1n && !run.machine.operationIsExact(atomic.op)) {
          run.absoluteRoundingIsLowerBound = true;
        }
        entry.intervalStart = decoded;
        entry.intervalLength = 0n;
      }
    };

    for (let iteration = 1; iteration <= step.count; iteration += 1) {
      if (options.signal?.aborted === true) {
        aborted = true;
        break;
      }
      exact = exactApply(exact, atomic.op, operand);

      for (const entry of plans) {
        if (entry.run.halted) continue;
        try {
          entry.repeat.iterate();
          entry.run.operations += 1;
          entry.intervalLength += 1n;
        } catch (error) {
          if (!(error instanceof MachineOperationError)) throw error;
          entry.run.events.push(error.event);
          entry.run.halted = true;
        }
      }

      const atCheckpoint = checkpoints.has(iteration);
      if (mode === 'per-iteration' || atCheckpoint) settle();
      if (atCheckpoint) sample(stepIndex, iteration);

      if (options.onProgress && iteration % chunkSize === 0) {
        options.onProgress({ stepIndex, iteration, count: step.count });
      }
    }
    // An aborted or overflow-halted repeat still accounts what it did complete.
    settle();
  };

  definition.steps.forEach((step, stepIndex) => {
    if (aborted) return;
    if (isRepeatStep(step)) {
      runRepeat(step, stepIndex);
    } else {
      runAtomic(step);
      sample(stepIndex);
    }
  });

  const machines: MachineResult[] = runs.map((run) => {
    const decoded = run.machine.decode();
    const raw = run.machine.rawState();
    return {
      id: run.machine.id,
      label: run.machine.label,
      description: run.machine.describe(),
      ledger: run.ledger,
      final: decoded === undefined ? {} : { decoded, signedDivergence: sub(decoded, exact) },
      ...(raw === undefined ? {} : { rawState: raw }),
      events: run.events,
      operations: run.operations,
      absoluteRoundingIsLowerBound: run.absoluteRoundingIsLowerBound,
    };
  });

  return {
    experimentId: definition.id,
    unit: definition.unit,
    exactFinal: exact,
    machines,
    samples,
    accounting,
    totalOperations: runs.reduce((total, run) => total + run.operations, 0),
    aborted,
  };
}
