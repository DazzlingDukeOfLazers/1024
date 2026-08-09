/**
 * The interface every simulated representation presents to the runner.
 *
 * docs/ARCHITECTURE.md lists what a representation must expose. Two rules shape
 * this design:
 *
 * 1. A machine never sees another machine's state, and never sees the exact
 *    reference state. It receives its own state and an exact operand, and it
 *    encodes that operand itself. Nothing can "repair" one representation using
 *    another.
 * 2. A machine reports *what it did* — the value it now holds and the value it
 *    understood the operand to be. The runner derives the docs/NUMERICS.md §7
 *    decomposition from those, so the decomposition lives in exactly one place.
 */

import { type Rational } from '../rational/rational';
import { type OverflowEvent } from '../representations/integers';
import { type AtomicExperimentStep, type AtomicOp } from './steps';

export interface MachineEvent {
  kind: 'overflow' | 'non-finite' | 'rejected';
  machineId: string;
  detail: string;
  overflow?: OverflowEvent;
}

/** Thrown by `RepeatPlan.iterate` so a repeat can stop at the failing operation. */
export class MachineOperationError extends Error {
  readonly event: MachineEvent;

  constructor(event: MachineEvent) {
    super(event.detail);
    this.name = 'MachineOperationError';
    this.event = event;
  }
}

export interface MachineOpResult<S> {
  state: S;
  /** Exact value now held. Undefined when the machine holds no rational (±Inf, NaN, refused). */
  decoded?: Rational;
  /**
   * The operand as this machine represented it, in the operand's own domain.
   * For a machine that stores the operand (binary64) this is the quantized
   * operand; for one that applies an exact scalar without storing it, it is the
   * operand unchanged.
   */
  representedOperand: Rational;
  events: readonly MachineEvent[];
}

/**
 * A repeated identical step with its operand encoding hoisted out of the loop.
 *
 * `iterate` must still perform one real machine operation. This exists so a
 * million iterations do not re-quantize a constant operand a million times —
 * never to collapse repeated addition into a multiplication
 * (docs/NUMERICS.md §11).
 */
export interface RepeatPlan<S> {
  representedOperand: Rational;
  /** One real machine operation. Throws {@link MachineOperationError} on overflow. */
  iterate(state: S): S;
}

export interface MachineDescription {
  id: string;
  label: string;
  /** Total register width in bits, where the machine has one. */
  widthBits?: number;
  /** Smallest step the machine can resolve near the current value, if constant. */
  resolution?: Rational;
  note?: string;
}

export interface Machine<S> {
  readonly id: string;
  readonly label: string;
  initial(): S;
  decode(state: S): Rational | undefined;
  apply(state: S, step: AtomicExperimentStep): MachineOpResult<S>;
  plan(step: AtomicExperimentStep): RepeatPlan<S>;
  /**
   * True when this operation introduces no rounding of its own, so all error
   * for the step is operand encoding. Fixed-point and integer addition qualify;
   * binary64 addition does not.
   */
  operationIsExact(op: AtomicOp): boolean;
  describe(): MachineDescription;
  /** Raw register contents, for the trace and the bit inspector. */
  rawState?(state: S): string;
}

/**
 * A machine with its state type erased and its state held internally.
 *
 * The runner is sequential and stateful by nature; binding the state here keeps
 * that mutability local to one run instead of pushing `any` through the runner's
 * signatures.
 */
export interface BoundMachine {
  readonly id: string;
  readonly label: string;
  decode(): Rational | undefined;
  apply(step: AtomicExperimentStep): Omit<MachineOpResult<unknown>, 'state'>;
  beginRepeat(step: AtomicExperimentStep): BoundRepeat;
  operationIsExact(op: AtomicOp): boolean;
  describe(): MachineDescription;
  rawState(): string | undefined;
}

export interface BoundRepeat {
  representedOperand: Rational;
  /** One real machine operation. Throws {@link MachineOperationError} on overflow. */
  iterate(): void;
}

export function bindMachine<S>(machine: Machine<S>): BoundMachine {
  let state = machine.initial();

  return {
    id: machine.id,
    label: machine.label,
    decode: () => machine.decode(state),
    apply(step) {
      const result = machine.apply(state, step);
      state = result.state;
      return {
        ...(result.decoded === undefined ? {} : { decoded: result.decoded }),
        representedOperand: result.representedOperand,
        events: result.events,
      };
    },
    beginRepeat(step) {
      const plan = machine.plan(step);
      return {
        representedOperand: plan.representedOperand,
        iterate() {
          state = plan.iterate(state);
        },
      };
    },
    operationIsExact: (op) => machine.operationIsExact(op),
    describe: () => machine.describe(),
    rawState: () => machine.rawState?.(state),
  };
}
