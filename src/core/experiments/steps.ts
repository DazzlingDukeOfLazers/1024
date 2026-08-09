/**
 * Experiment step definitions.
 *
 * docs/ARCHITECTURE.md: steps are immutable and serializable, and `repeat` is a
 * first-class operation rather than an unrolled list. docs/NUMERICS.md §11: a
 * repeat still executes every machine operation — it is the *trace* that is
 * compact, never the arithmetic.
 */

import { type Rational } from '../rational/rational';
import { type RationalJSON, fromJSON, toJSON } from '../rational/json';

export const ATOMIC_OPS = ['set', 'add', 'sub', 'mul', 'div'] as const;
export type AtomicOp = (typeof ATOMIC_OPS)[number];

/** `mul` and `div` take a dimensionless scalar; the rest take a quantity. */
export function isScalarOp(op: AtomicOp): boolean {
  return op === 'mul' || op === 'div';
}

export interface AtomicExperimentStep {
  readonly op: AtomicOp;
  readonly value: Rational;
}

export interface RepeatTracePolicy {
  /** Sample the first N iterations. */
  readonly first?: number;
  /** Sample the last N iterations. */
  readonly last?: number;
  /** Sample at these 1-based iteration numbers. */
  readonly checkpoints?: readonly number[];
  /**
   * How finely to account for error.
   *
   * `per-iteration` decomposes every single iteration — full fidelity, and far
   * too slow for a million steps. `interval` decomposes each checkpoint
   * interval as one composite step, which is exactly equal for `add`/`sub`
   * (see docs/NUMERICS.md §11 and the runner). `auto` picks per-iteration for
   * short repeats and interval for long ones.
   */
  readonly accounting?: 'auto' | 'per-iteration' | 'interval';
}

export interface RepeatExperimentStep {
  readonly op: 'repeat';
  readonly count: number;
  readonly step: AtomicExperimentStep;
  readonly trace?: RepeatTracePolicy;
}

export type ExperimentStep = AtomicExperimentStep | RepeatExperimentStep;

export function isRepeatStep(step: ExperimentStep): step is RepeatExperimentStep {
  return step.op === 'repeat';
}

export interface ExperimentDefinition {
  readonly id: string;
  readonly name: string;
  /** Unit every operand and result is expressed in. */
  readonly unit: string;
  readonly steps: readonly ExperimentStep[];
  readonly note?: string;
}

export class ExperimentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentError';
  }
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

export interface AtomicStepJSON {
  op: AtomicOp;
  value: RationalJSON;
}

export interface RepeatStepJSON {
  op: 'repeat';
  count: number;
  step: AtomicStepJSON;
  trace?: RepeatTracePolicy;
}

export type ExperimentStepJSON = AtomicStepJSON | RepeatStepJSON;

export interface ExperimentDefinitionJSON {
  id: string;
  name: string;
  unit: string;
  steps: ExperimentStepJSON[];
  note?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function atomicFromJSON(json: unknown): AtomicExperimentStep {
  if (!isRecord(json) || typeof json.op !== 'string') {
    throw new ExperimentError(`Not an experiment step: ${JSON.stringify(json)}`);
  }
  if (!(ATOMIC_OPS as readonly string[]).includes(json.op)) {
    throw new ExperimentError(`Unknown atomic op: ${json.op}`);
  }
  return Object.freeze({
    op: json.op as AtomicOp,
    value: fromJSON(json.value as RationalJSON),
  });
}

export function stepFromJSON(json: unknown): ExperimentStep {
  if (!isRecord(json)) {
    throw new ExperimentError(`Not an experiment step: ${JSON.stringify(json)}`);
  }
  if (json.op !== 'repeat') {
    return atomicFromJSON(json);
  }
  if (typeof json.count !== 'number' || !Number.isInteger(json.count) || json.count < 0) {
    throw new ExperimentError(
      `repeat count must be a non-negative integer, got ${String(json.count)}`,
    );
  }
  const repeated = atomicFromJSON(json.step);
  const base = { op: 'repeat' as const, count: json.count, step: repeated };
  return Object.freeze(
    json.trace === undefined
      ? base
      : { ...base, trace: Object.freeze({ ...(json.trace as RepeatTracePolicy) }) },
  );
}

export function stepToJSON(step: ExperimentStep): ExperimentStepJSON {
  if (!isRepeatStep(step)) {
    return { op: step.op, value: toJSON(step.value) };
  }
  const base: RepeatStepJSON = {
    op: 'repeat',
    count: step.count,
    step: { op: step.step.op, value: toJSON(step.step.value) },
  };
  return step.trace === undefined ? base : { ...base, trace: step.trace };
}

export function experimentFromJSON(json: unknown): ExperimentDefinition {
  if (!isRecord(json) || typeof json.id !== 'string' || typeof json.unit !== 'string') {
    throw new ExperimentError(`Not an experiment definition: ${JSON.stringify(json)}`);
  }
  if (!Array.isArray(json.steps)) {
    throw new ExperimentError(`Experiment ${json.id} has no steps`);
  }
  const definition = {
    id: json.id,
    name: typeof json.name === 'string' ? json.name : json.id,
    unit: json.unit,
    steps: Object.freeze(json.steps.map(stepFromJSON)),
  };
  return Object.freeze(
    typeof json.note === 'string' ? { ...definition, note: json.note } : definition,
  );
}

export function experimentToJSON(definition: ExperimentDefinition): ExperimentDefinitionJSON {
  const json: ExperimentDefinitionJSON = {
    id: definition.id,
    name: definition.name,
    unit: definition.unit,
    steps: definition.steps.map(stepToJSON),
  };
  return definition.note === undefined ? json : { ...json, note: definition.note };
}

/* -------------------------------------------------------------------------- */
/* Trace policy resolution                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The 1-based iteration numbers a repeat should sample, ascending and unique.
 * The final iteration is always sampled — a run with no end state would be
 * useless.
 */
export function resolveCheckpoints(count: number, policy: RepeatTracePolicy = {}): number[] {
  const sampled = new Set<number>();
  const first = Math.min(policy.first ?? 0, count);
  for (let i = 1; i <= first; i += 1) sampled.add(i);

  const last = Math.min(policy.last ?? 0, count);
  for (let i = count - last + 1; i <= count; i += 1) {
    if (i >= 1) sampled.add(i);
  }

  for (const checkpoint of policy.checkpoints ?? []) {
    if (Number.isInteger(checkpoint) && checkpoint >= 1 && checkpoint <= count) {
      sampled.add(checkpoint);
    }
  }
  if (count > 0) sampled.add(count);

  return [...sampled].sort((a, b) => a - b);
}

/** Repeats longer than this decompose per interval rather than per iteration. */
export const PER_ITERATION_ACCOUNTING_LIMIT = 10_000;

export type AccountingMode = 'per-iteration' | 'interval';

/**
 * Interval accounting is only exactly equal to per-iteration accounting for
 * `add` and `sub`, where the operand is constant and the operation does not
 * scale existing error. Anything else always accounts per iteration.
 */
export function resolveAccounting(step: RepeatExperimentStep): AccountingMode {
  const requested = step.trace?.accounting ?? 'auto';
  const intervalIsSound = step.step.op === 'add' || step.step.op === 'sub';

  if (!intervalIsSound) return 'per-iteration';
  if (requested === 'per-iteration') return 'per-iteration';
  if (requested === 'interval') return 'interval';
  return step.count > PER_ITERATION_ACCOUNTING_LIMIT ? 'interval' : 'per-iteration';
}
