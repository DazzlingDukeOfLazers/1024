/**
 * Scenario settings — the machine contract, as a value.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §14. The document gives a YAML sketch and
 * then the thing that sketch is for:
 *
 *     Scenario A: preserve everything
 *     Scenario B: round to destination
 *     Scenario C: trap on any inexact result
 *     Scenario D: truncate and discard residue
 *
 * The same workload runs under each, and the comparison is the experiment. That
 * only means anything if the policies are the *only* difference, so a scenario
 * is a plain value threaded through the operations rather than an ambient
 * setting, and the workload runner takes one.
 */

import type { NarrowPolicy } from './narrow';
import type { DigitWidth } from './digits';

export interface ScenarioArchitecture {
  readonly registerBits: number;
  readonly digitBits: DigitWidth;
  /** Fraction bits of the working format — the Q in Q(n).(fractionBits). */
  readonly fractionBits: number;
}

export interface ScenarioOptimization {
  readonly skipZeroDigits: boolean;
  /** Reported per §3; nothing dispatches on it yet, so it is a declaration. */
  readonly significantWidthDispatch: boolean;
}

export interface ScenarioDivision {
  /** §12's budget: how far to chase a quotient that does not terminate. */
  readonly maxFractionBits: number;
}

export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** What the scenario is for, in the words of §14 where it has them. */
  readonly intent: string;
  readonly architecture: ScenarioArchitecture;
  readonly narrowing: NarrowPolicy;
  readonly optimization: ScenarioOptimization;
  readonly division: ScenarioDivision;
}

const ARCHITECTURE: ScenarioArchitecture = {
  registerBits: 1024,
  digitBits: 64,
  fractionBits: 128,
};

const OPTIMIZATION: ScenarioOptimization = {
  skipZeroDigits: true,
  significantWidthDispatch: true,
};

const DIVISION: ScenarioDivision = { maxFractionBits: 256 };

/**
 * The four scenarios §14 names.
 *
 * `preserve` is the interesting one and needed a decision. "Preserve
 * everything" cannot mean "never narrow", because a fixed-width machine has to
 * come back to its working format eventually. It means narrow but keep the
 * leftovers: the residue is accumulated rather than dropped, so the information
 * is deferred rather than destroyed and the run can still say exactly what the
 * answer was. That is the reading `ACCUMULATE_RESIDUE` in §8 supports, and the
 * workload tests assert the conservation it implies.
 */
export const SCENARIOS = {
  preserve: {
    id: 'preserve',
    label: 'Preserve everything',
    intent: 'Narrow to the working format, and carry every lost bit forward as residue.',
    architecture: ARCHITECTURE,
    narrowing: { rounding: 'truncate', range: 'trap', inexact: 'allow', residue: 'accumulate' },
    optimization: OPTIMIZATION,
    division: DIVISION,
  },
  round: {
    id: 'round',
    label: 'Round to destination',
    intent: 'Round to nearest even at every narrowing, and let the residue go.',
    architecture: ARCHITECTURE,
    narrowing: { rounding: 'nearest-even', range: 'trap', inexact: 'allow', residue: 'discard' },
    optimization: OPTIMIZATION,
    division: DIVISION,
  },
  strict: {
    id: 'strict',
    label: 'Trap on any inexact result',
    intent: 'Refuse to proceed on a number that is no longer the one that was asked for.',
    architecture: ARCHITECTURE,
    narrowing: { rounding: 'nearest-even', range: 'trap', inexact: 'trap', residue: 'keep' },
    optimization: OPTIMIZATION,
    division: DIVISION,
  },
  truncate: {
    id: 'truncate',
    label: 'Truncate and discard residue',
    intent: 'The cheapest policy, and the one that drifts.',
    architecture: ARCHITECTURE,
    narrowing: { rounding: 'truncate', range: 'trap', inexact: 'allow', residue: 'discard' },
    optimization: OPTIMIZATION,
    division: DIVISION,
  },
} as const satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];
