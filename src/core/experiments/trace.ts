/**
 * Serialization for experiment results.
 *
 * docs/NUMERICS.md §14: every exact value crosses the boundary as a string, and
 * every finite register as an explicit pattern. A restored result must be
 * numerically identical to the one that was saved — that is what makes a
 * discovered numerical failure sendable as a link rather than as reproduction
 * instructions.
 */

import { type Rational } from '../rational/rational';
import {
  type RationalJSON,
  fromJSON as rationalFromJSON,
  toJSON as rationalToJSON,
} from '../rational/json';
import {
  type FixedPointJSON,
  fromJSON as fixedFromJSON,
  toJSON as fixedToJSON,
} from '../representations/fixedPoint';
import { type ErrorLedger } from '../representations/errorLedger';
import { type OverflowEvent } from '../representations/integers';
import { type MachineDescription, type MachineEvent } from './machine';
import {
  type ExperimentResult,
  type MachineResult,
  type MachineSample,
  type TraceSample,
} from './runner';
import { type AccountingMode } from './steps';

export const TRACE_SCHEMA_VERSION = 1;

type OptionalRational = Rational | undefined;

function optionalToJSON(value: OptionalRational): RationalJSON | undefined {
  return value === undefined ? undefined : rationalToJSON(value);
}

function optionalFromJSON(value: RationalJSON | undefined): OptionalRational {
  return value === undefined ? undefined : rationalFromJSON(value);
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * Drop keys whose value is `undefined`, and say so in the type. Under
 * exactOptionalPropertyTypes an absent key and a key holding `undefined` are
 * different things, and only the former survives a JSON round trip.
 */
function compact<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Defined<T>;
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

export interface MachineSampleJSON {
  decoded?: RationalJSON;
  signedDivergence?: RationalJSON;
}

export interface TraceSampleJSON {
  stepIndex: number;
  iteration?: number;
  exact: RationalJSON;
  machines: Record<string, MachineSampleJSON>;
}

export interface ErrorLedgerJSON {
  currentSignedDivergence: RationalJSON;
  currentAbsoluteDivergence: RationalJSON;
  currentSignedInheritedPropagation: RationalJSON;
  exactRawOperandEncodingDelta?: RationalJSON;
  exactSignedOperandEncodingContribution: RationalJSON;
  exactAbsoluteOperandEncodingContribution: RationalJSON;
  exactSignedOperationRoundingError: RationalJSON;
  exactAbsoluteOperationRoundingError: RationalJSON;
  cumulativeAbsoluteOperandEncodingContribution: RationalJSON;
  cumulativeAbsoluteOperationRoundingError: RationalJSON;
  cumulativeSignedIntroducedError: RationalJSON;
  q512_512SignedAccumulator: FixedPointJSON;
  q512_512AbsoluteAccumulator: FixedPointJSON;
  meterEvents: OverflowEvent[];
  steps: number;
}

export interface MachineDescriptionJSON {
  id: string;
  label: string;
  widthBits?: number;
  resolution?: RationalJSON;
  note?: string;
}

export interface MachineResultJSON {
  id: string;
  label: string;
  description: MachineDescriptionJSON;
  ledger: ErrorLedgerJSON;
  final: MachineSampleJSON;
  rawState?: string;
  events: MachineEvent[];
  operations: number;
  absoluteRoundingIsLowerBound: boolean;
}

export interface ExperimentResultJSON {
  version: number;
  experimentId: string;
  unit: string;
  exactFinal: RationalJSON;
  machines: MachineResultJSON[];
  samples: TraceSampleJSON[];
  accounting: Record<string, AccountingMode>;
  totalOperations: number;
  aborted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Encode                                                                      */
/* -------------------------------------------------------------------------- */

function sampleToJSON(sample: MachineSample): MachineSampleJSON {
  return compact({
    decoded: optionalToJSON(sample.decoded),
    signedDivergence: optionalToJSON(sample.signedDivergence),
  });
}

function ledgerToJSON(ledger: ErrorLedger): ErrorLedgerJSON {
  return compact({
    currentSignedDivergence: rationalToJSON(ledger.currentSignedDivergence),
    currentAbsoluteDivergence: rationalToJSON(ledger.currentAbsoluteDivergence),
    currentSignedInheritedPropagation: rationalToJSON(ledger.currentSignedInheritedPropagation),
    exactRawOperandEncodingDelta: optionalToJSON(ledger.exactRawOperandEncodingDelta),
    exactSignedOperandEncodingContribution: rationalToJSON(
      ledger.exactSignedOperandEncodingContribution,
    ),
    exactAbsoluteOperandEncodingContribution: rationalToJSON(
      ledger.exactAbsoluteOperandEncodingContribution,
    ),
    exactSignedOperationRoundingError: rationalToJSON(ledger.exactSignedOperationRoundingError),
    exactAbsoluteOperationRoundingError: rationalToJSON(ledger.exactAbsoluteOperationRoundingError),
    cumulativeAbsoluteOperandEncodingContribution: rationalToJSON(
      ledger.cumulativeAbsoluteOperandEncodingContribution,
    ),
    cumulativeAbsoluteOperationRoundingError: rationalToJSON(
      ledger.cumulativeAbsoluteOperationRoundingError,
    ),
    cumulativeSignedIntroducedError: rationalToJSON(ledger.cumulativeSignedIntroducedError),
    q512_512SignedAccumulator: fixedToJSON(ledger.q512_512SignedAccumulator),
    q512_512AbsoluteAccumulator: fixedToJSON(ledger.q512_512AbsoluteAccumulator),
    meterEvents: [...ledger.meterEvents],
    steps: ledger.steps,
  });
}

function descriptionToJSON(description: MachineDescription): MachineDescriptionJSON {
  return compact({
    id: description.id,
    label: description.label,
    widthBits: description.widthBits,
    resolution: optionalToJSON(description.resolution),
    note: description.note,
  });
}

function machineToJSON(machine: MachineResult): MachineResultJSON {
  return compact({
    id: machine.id,
    label: machine.label,
    description: descriptionToJSON(machine.description),
    ledger: ledgerToJSON(machine.ledger),
    final: sampleToJSON(machine.final),
    rawState: machine.rawState,
    events: [...machine.events],
    operations: machine.operations,
    absoluteRoundingIsLowerBound: machine.absoluteRoundingIsLowerBound,
  });
}

export function resultToJSON(result: ExperimentResult): ExperimentResultJSON {
  return {
    version: TRACE_SCHEMA_VERSION,
    experimentId: result.experimentId,
    unit: result.unit,
    exactFinal: rationalToJSON(result.exactFinal),
    machines: result.machines.map(machineToJSON),
    samples: result.samples.map((sample) =>
      compact({
        stepIndex: sample.stepIndex,
        iteration: sample.iteration,
        exact: rationalToJSON(sample.exact),
        machines: Object.fromEntries(
          Object.entries(sample.machines).map(([id, value]) => [id, sampleToJSON(value)]),
        ),
      }),
    ),
    accounting: Object.fromEntries(
      Object.entries(result.accounting).map(([index, mode]) => [index, mode]),
    ),
    totalOperations: result.totalOperations,
    aborted: result.aborted,
  };
}

/* -------------------------------------------------------------------------- */
/* Decode                                                                      */
/* -------------------------------------------------------------------------- */

function sampleFromJSON(json: MachineSampleJSON): MachineSample {
  return compact({
    decoded: optionalFromJSON(json.decoded),
    signedDivergence: optionalFromJSON(json.signedDivergence),
  });
}

function ledgerFromJSON(json: ErrorLedgerJSON): ErrorLedger {
  return compact({
    currentSignedDivergence: rationalFromJSON(json.currentSignedDivergence),
    currentAbsoluteDivergence: rationalFromJSON(json.currentAbsoluteDivergence),
    currentSignedInheritedPropagation: rationalFromJSON(json.currentSignedInheritedPropagation),
    exactRawOperandEncodingDelta: optionalFromJSON(json.exactRawOperandEncodingDelta),
    exactSignedOperandEncodingContribution: rationalFromJSON(
      json.exactSignedOperandEncodingContribution,
    ),
    exactAbsoluteOperandEncodingContribution: rationalFromJSON(
      json.exactAbsoluteOperandEncodingContribution,
    ),
    exactSignedOperationRoundingError: rationalFromJSON(json.exactSignedOperationRoundingError),
    exactAbsoluteOperationRoundingError: rationalFromJSON(json.exactAbsoluteOperationRoundingError),
    cumulativeAbsoluteOperandEncodingContribution: rationalFromJSON(
      json.cumulativeAbsoluteOperandEncodingContribution,
    ),
    cumulativeAbsoluteOperationRoundingError: rationalFromJSON(
      json.cumulativeAbsoluteOperationRoundingError,
    ),
    cumulativeSignedIntroducedError: rationalFromJSON(json.cumulativeSignedIntroducedError),
    q512_512SignedAccumulator: fixedFromJSON(json.q512_512SignedAccumulator),
    q512_512AbsoluteAccumulator: fixedFromJSON(json.q512_512AbsoluteAccumulator),
    meterEvents: json.meterEvents,
    steps: json.steps,
  }) as ErrorLedger;
}

export function resultFromJSON(json: ExperimentResultJSON): ExperimentResult {
  if (json.version !== TRACE_SCHEMA_VERSION) {
    throw new Error(`Unsupported trace schema version ${json.version}`);
  }
  return {
    experimentId: json.experimentId,
    unit: json.unit,
    exactFinal: rationalFromJSON(json.exactFinal),
    machines: json.machines.map((machine) =>
      compact({
        id: machine.id,
        label: machine.label,
        description: compact({
          id: machine.description.id,
          label: machine.description.label,
          widthBits: machine.description.widthBits,
          resolution: optionalFromJSON(machine.description.resolution),
          note: machine.description.note,
        }),
        ledger: ledgerFromJSON(machine.ledger),
        final: sampleFromJSON(machine.final),
        rawState: machine.rawState,
        events: machine.events,
        operations: machine.operations,
        absoluteRoundingIsLowerBound: machine.absoluteRoundingIsLowerBound,
      }),
    ),
    samples: json.samples.map((sample): TraceSample =>
      compact({
        stepIndex: sample.stepIndex,
        iteration: sample.iteration,
        exact: rationalFromJSON(sample.exact),
        machines: Object.fromEntries(
          Object.entries(sample.machines).map(([id, value]) => [id, sampleFromJSON(value)]),
        ),
      }),
    ),
    accounting: Object.fromEntries(
      Object.entries(json.accounting).map(([index, mode]) => [Number(index), mode]),
    ),
    totalOperations: json.totalOperations,
    aborted: json.aborted,
  };
}
