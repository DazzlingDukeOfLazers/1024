/**
 * Built-in experiments, loaded from `fixtures/experiments.json`.
 *
 * The fixture file is the authored source; this module only validates it. The
 * non-arithmetic entries (the base-unit comparison and the floating-origin
 * demonstration) are not step sequences and are handled by their own modules.
 */

import rawExperiments from '../../../fixtures/experiments.json';
import { type ExperimentDefinition, ExperimentError, experimentFromJSON } from './steps';

interface FixtureEntry {
  id?: unknown;
  kind?: unknown;
}

const entries = rawExperiments as unknown as FixtureEntry[];

export const BUILT_IN_EXPERIMENTS: readonly ExperimentDefinition[] = Object.freeze(
  entries.filter((entry) => entry.kind === 'arithmetic').map(experimentFromJSON),
);

export function findExperiment(id: string): ExperimentDefinition | undefined {
  return BUILT_IN_EXPERIMENTS.find((experiment) => experiment.id === id);
}

export function requireExperiment(id: string): ExperimentDefinition {
  const experiment = findExperiment(id);
  if (experiment === undefined) {
    throw new ExperimentError(`No built-in experiment with id ${JSON.stringify(id)}`);
  }
  return experiment;
}

/** Raw fixture entry for a non-arithmetic experiment, for its own module to read. */
export function rawFixture(id: string): unknown {
  return entries.find((entry) => entry.id === id);
}
