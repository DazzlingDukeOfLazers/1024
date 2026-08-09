/**
 * Machine adapters for the representations built in milestones 2 and 3.
 *
 * Each adapter is a thin shell over its representation module. It performs the
 * real machine operation and reports what it did — it never computes the error
 * decomposition, and it never reads anything outside its own state.
 */

import { type Rational, add, div, mul, rational, roundToBigInt, sub } from '../rational/rational';
import {
  type FixedPointState,
  Q128_128,
  decode as decodeFixed,
  rawHex,
  zeroState,
} from '../representations/fixedPoint';
import {
  type Q128_128Config,
  DEFAULT_Q128_128_CONFIG,
  physicalLsbMeters,
} from '../representations/q128_128';
import {
  type PlanckConfig,
  type PlanckState,
  DEFAULT_PLANCK_CONFIG,
  PLANCK_REGISTER_WIDTH,
  decodeTicks,
} from '../representations/planck';
import {
  type Binary64State,
  bitsOf,
  encodeRational,
  fromNumber,
  isFiniteState,
  toNumber,
} from '../representations/binary64';
import { type OverflowEvent, storeSigned } from '../representations/integers';
import {
  type Machine,
  type MachineEvent,
  type MachineOpResult,
  MachineOperationError,
  bindMachine,
  type BoundMachine,
} from './machine';
import { type AtomicExperimentStep, type AtomicOp } from './steps';

function overflowEvent(machineId: string, overflow: OverflowEvent): MachineEvent {
  return {
    kind: 'overflow',
    machineId,
    detail: `${machineId} register overflowed ${overflow.direction} its ${overflow.width}-bit range`,
    overflow,
  };
}

/**
 * Shared shape for the two machines that hold an integer count of a fixed
 * quantum: quantize the operand, add or subtract raw units, refuse to overflow.
 */
interface QuantizedIntegerMachine {
  id: string;
  label: string;
  widthBits: number;
  /** Exact SI size of one raw unit. */
  quantum: Rational;
  overflowMode: OverflowEvent['mode'];
  rounding: Parameters<typeof roundToBigInt>[1];
  note: string;
}

/* -------------------------------------------------------------------------- */
/* Q128.128 at a configurable base unit                                        */
/* -------------------------------------------------------------------------- */

export function q128Machine(
  config: Q128_128Config = DEFAULT_Q128_128_CONFIG,
  id = `q128.128@${config.baseUnitLabel}`,
): Machine<FixedPointState> {
  const label = `Q128.128 @ ${config.baseUnitLabel}`;
  const spec: QuantizedIntegerMachine = {
    id,
    label,
    widthBits: Q128_128.widthBits,
    quantum: physicalLsbMeters(config),
    overflowMode: config.overflow,
    rounding: config.rounding,
    note: 'Constant absolute resolution; the base unit trades range against resolution.',
  };

  const toMeters = (state: FixedPointState): Rational =>
    mul(decodeFixed(state), config.baseUnitMeters);
  const quantize = (meters: Rational): bigint =>
    roundToBigInt(div(meters, spec.quantum), spec.rounding);
  const store = (raw: bigint): FixedPointState => {
    const result = storeSigned(spec.widthBits, raw, spec.overflowMode);
    if (result.status === 'rejected')
      throw new MachineOperationError(overflowEvent(id, result.overflow));
    return { format: Q128_128, raw: result.value };
  };

  return quantizedMachine(spec, {
    initial: () => zeroState(Q128_128),
    decode: toMeters,
    quantize,
    store,
    rawOf: (state) => state.raw,
    rawState: (state) => rawHex(state),
  });
}

/* -------------------------------------------------------------------------- */
/* Planck grid                                                                 */
/* -------------------------------------------------------------------------- */

export function planckMachine(
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
  id = 'planck-int256',
): Machine<PlanckState> {
  const constant = config.constants.planckLength;
  const spec: QuantizedIntegerMachine = {
    id,
    label: 'Planck grid (256-bit)',
    widthBits: PLANCK_REGISTER_WIDTH,
    quantum: constant.nominal,
    overflowMode: config.overflow,
    rounding: config.rounding,
    note: `Conditioned on ${constant.source} ${constant.sourceVersion}. A representation thought experiment, not a claim about spacetime.`,
  };

  const store = (ticks: bigint): PlanckState => {
    const result = storeSigned(spec.widthBits, ticks, spec.overflowMode);
    if (result.status === 'rejected')
      throw new MachineOperationError(overflowEvent(id, result.overflow));
    return { ticks: result.value };
  };

  return quantizedMachine(spec, {
    initial: () => ({ ticks: 0n }),
    decode: (state) => decodeTicks(constant, state),
    quantize: (meters) => roundToBigInt(div(meters, spec.quantum), spec.rounding),
    store,
    rawOf: (state) => state.ticks,
    rawState: (state) => state.ticks.toString(10),
  });
}

/* -------------------------------------------------------------------------- */
/* The shared quantized-integer implementation                                 */
/* -------------------------------------------------------------------------- */

interface QuantizedOps<S> {
  initial(): S;
  decode(state: S): Rational;
  quantize(meters: Rational): bigint;
  store(raw: bigint): S;
  rawOf(state: S): bigint;
  rawState(state: S): string;
}

function quantizedMachine<S>(spec: QuantizedIntegerMachine, ops: QuantizedOps<S>): Machine<S> {
  const representedOperandOf = (raw: bigint): Rational => mul(rational(raw), spec.quantum);

  const applyStep = (state: S, step: AtomicExperimentStep): MachineOpResult<S> => {
    try {
      switch (step.op) {
        case 'set': {
          const raw = ops.quantize(step.value);
          const next = ops.store(raw);
          return {
            state: next,
            decoded: ops.decode(next),
            representedOperand: representedOperandOf(raw),
            events: [],
          };
        }
        case 'add':
        case 'sub': {
          const magnitude = ops.quantize(step.value);
          const delta = step.op === 'add' ? magnitude : -magnitude;
          const next = ops.store(ops.rawOf(state) + delta);
          return {
            state: next,
            decoded: ops.decode(next),
            representedOperand: representedOperandOf(magnitude),
            events: [],
          };
        }
        case 'mul':
        case 'div': {
          // The scalar is exact and never enters a register, so every bit of the
          // error here belongs to the operation rather than to operand encoding.
          const current = ops.decode(state);
          const ideal = step.op === 'mul' ? mul(current, step.value) : div(current, step.value);
          const next = ops.store(ops.quantize(ideal));
          return {
            state: next,
            decoded: ops.decode(next),
            representedOperand: step.value,
            events: [],
          };
        }
      }
    } catch (error) {
      if (error instanceof MachineOperationError) {
        return { state, representedOperand: step.value, events: [error.event] };
      }
      throw error;
    }
  };

  return {
    id: spec.id,
    label: spec.label,
    initial: ops.initial,
    decode: ops.decode,
    // Integer addition of already-quantized values is exact until it overflows.
    operationIsExact: (op) => op === 'set' || op === 'add' || op === 'sub',
    apply: applyStep,

    plan(step) {
      if (step.op !== 'add' && step.op !== 'sub') {
        return {
          representedOperand: step.value,
          iterate: (state) => {
            const result = applyStep(state, step);
            const failure = result.events[0];
            if (failure !== undefined) throw new MachineOperationError(failure);
            return result.state;
          },
        };
      }
      // Hoisted: the operand is quantized once, then each iteration is a single
      // integer add plus a range check — exactly what the register does.
      const magnitude = ops.quantize(step.value);
      const delta = step.op === 'add' ? magnitude : -magnitude;
      return {
        representedOperand: representedOperandOf(magnitude),
        iterate: (state) => ops.store(ops.rawOf(state) + delta),
      };
    },

    describe: () => ({
      id: spec.id,
      label: spec.label,
      widthBits: spec.widthBits,
      resolution: spec.quantum,
      note: spec.note,
    }),

    rawState: ops.rawState,
  };
}

/* -------------------------------------------------------------------------- */
/* binary64                                                                    */
/* -------------------------------------------------------------------------- */

export function binary64Machine(id = 'binary64'): Machine<Binary64State> {
  const applyNative = (state: Binary64State, op: AtomicOp, operand: number): Binary64State => {
    const current = toNumber(state);
    switch (op) {
      case 'set':
        return fromNumber(operand);
      case 'add':
        return fromNumber(current + operand);
      case 'sub':
        return fromNumber(current - operand);
      case 'mul':
        return fromNumber(current * operand);
      case 'div':
        return fromNumber(current / operand);
    }
  };

  const nonFiniteEvents = (state: Binary64State): MachineEvent[] =>
    isFiniteState(state)
      ? []
      : [{ kind: 'non-finite', machineId: id, detail: `binary64 reached ${state.kind}` }];

  return {
    id,
    label: 'binary64',
    initial: () => fromNumber(0),
    decode: (state) => (isFiniteState(state) ? state.exact : undefined),
    // Any binary64 operation may round. That is the lesson, not a defect.
    operationIsExact: () => false,

    apply(state, step) {
      // The operand has to become a double before the machine can touch it, so
      // its encoding error is real and is reported apart from the operation's.
      const encoded = encodeRational(step.value);
      const next = applyNative(state, step.op, toNumber(encoded.state));
      const decoded = isFiniteState(next) ? next.exact : undefined;

      return {
        state: next,
        ...(decoded === undefined ? {} : { decoded }),
        representedOperand: isFiniteState(encoded.state) ? encoded.state.exact : step.value,
        events: nonFiniteEvents(next),
      };
    },

    plan(step) {
      const encoded = encodeRational(step.value);
      const operand = toNumber(encoded.state);
      return {
        representedOperand: isFiniteState(encoded.state) ? encoded.state.exact : step.value,
        iterate: (state) => applyNative(state, step.op, operand),
      };
    },

    describe: () => ({
      id,
      label: 'binary64',
      widthBits: 64,
      note: 'Resolution varies with magnitude; there is no single constant LSB.',
    }),

    rawState: (state) =>
      isFiniteState(state) ? `0x${bitsOf(state.value).toString(16).padStart(16, '0')}` : state.kind,
  };
}

/* -------------------------------------------------------------------------- */
/* Default set and exact reference arithmetic                                  */
/* -------------------------------------------------------------------------- */

/**
 * The rows docs/UI_SPEC.md lists for the Representation Lab. Each call returns
 * freshly bound machines, so two runs never share state.
 */
export function defaultBoundMachines(): BoundMachine[] {
  return [bindMachine(planckMachine()), bindMachine(q128Machine()), bindMachine(binary64Machine())];
}

/**
 * Exact arithmetic on the reference. This is not a machine — it is the truth
 * every machine is measured against, and it is unbounded.
 */
export function exactApply(previous: Rational, op: AtomicOp, operand: Rational): Rational {
  switch (op) {
    case 'set':
      return operand;
    case 'add':
      return add(previous, operand);
    case 'sub':
      return sub(previous, operand);
    case 'mul':
      return mul(previous, operand);
    case 'div':
      return div(previous, operand);
  }
}
