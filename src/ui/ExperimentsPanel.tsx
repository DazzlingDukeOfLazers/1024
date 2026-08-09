/**
 * Milestone 4 debug panel.
 *
 * Runs a built-in experiment through every machine at once and shows where they
 * ended up and why. Not the timeline UI from docs/UI_SPEC.md — that arrives with
 * milestone 9. This exists to make the runner's output inspectable.
 */

import { useMemo, useState } from 'react';
import { type Rational, isZero } from '../core/rational/rational';
import { quantity } from '../core/quantities/quantity';
import { formatCount, formatScientific } from '../core/units/format';
import { BUILT_IN_EXPERIMENTS, requireExperiment } from '../core/experiments/fixtures';
import { type ExperimentResult, runExperiment } from '../core/experiments/runner';
import { runFloatingOrigin, builtInFloatingOriginConfig } from '../core/experiments/floatingOrigin';
import { readAccumulator } from '../core/representations/q512_512';
import { metersToPlanckLengths } from '../core/representations/planck';

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

function inPlanckLengths(value: Rational): string {
  return isZero(value) ? '0' : `${formatCount(metersToPlanckLengths(value)).text} lP`;
}

function ExperimentReadout({ result }: { result: ExperimentResult }) {
  const accountedPerInterval = Object.values(result.accounting).includes('interval');

  return (
    <>
      <table className="readout">
        <thead>
          <tr>
            <th scope="col">Representation</th>
            <th scope="col">Result</th>
            <th scope="col">Divergence from exact</th>
            <th scope="col">Introduced error by category</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Exact reference</th>
            <td className="mono">{meters(result.exactFinal)}</td>
            <td className="mono">
              <span className="tag tag-exact">truth</span>
            </td>
            <td className="mono">—</td>
          </tr>
          {result.machines.map((entry) => (
            <tr key={entry.id}>
              <th scope="row">{entry.label}</th>
              <td className="mono">
                {entry.final.decoded === undefined ? (
                  <span className="error">no rational value</span>
                ) : (
                  meters(entry.final.decoded)
                )}
                <br />
                <small>{entry.operations.toLocaleString()} operations</small>
              </td>
              <td className="mono">
                {entry.final.signedDivergence === undefined ? (
                  '—'
                ) : isZero(entry.final.signedDivergence) ? (
                  <span className="tag tag-exact">none</span>
                ) : (
                  <>
                    {meters(entry.final.signedDivergence)}
                    <br />
                    <small>{inPlanckLengths(entry.final.signedDivergence)}</small>
                  </>
                )}
              </td>
              <td className="mono">
                <small>
                  operand encoding{' '}
                  {meters(entry.ledger.cumulativeAbsoluteOperandEncodingContribution)}
                </small>
                <br />
                <small>
                  operation rounding {meters(entry.ledger.cumulativeAbsoluteOperationRoundingError)}
                  {entry.absoluteRoundingIsLowerBound && ' (lower bound)'}
                </small>
                <br />
                <small>
                  Q512.512 meter {meters(readAccumulator(entry.ledger.q512_512SignedAccumulator))}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="lens-question">
        {result.totalOperations.toLocaleString()} real machine operations, {result.samples.length}{' '}
        trace samples.
        {accountedPerInterval &&
          ' A long repeat was accounted per checkpoint interval: every figure stays exact except' +
            ' the absolute rounding total, which becomes a lower bound because errors that' +
            ' cancelled inside an interval cannot be recovered from its endpoints.'}
      </p>
    </>
  );
}

function FloatingOriginReadout() {
  const result = useMemo(() => runFloatingOrigin(builtInFloatingOriginConfig()), []);

  return (
    <table className="readout">
      <tbody>
        <tr>
          <th scope="row">Setup</th>
          <td className="mono">
            two points {meters(result.localOffsetMeters)} apart, around an origin of{' '}
            {meters(result.originMeters)}
          </td>
        </tr>
        <tr>
          <th scope="row">binary64 spacing there</th>
          <td className="mono">
            {result.gapAtOrigin === undefined ? '—' : meters(result.gapAtOrigin)}
          </td>
        </tr>
        <tr>
          <th scope="row">Absolute coordinates</th>
          <td className="mono">
            separation {meters(result.absolute.separation)}{' '}
            {result.absolute.separationLost && <span className="error">lost entirely</span>}
          </td>
        </tr>
        <tr>
          <th scope="row">Origin subtracted first</th>
          <td className="mono">
            separation {meters(result.rebased.separation)}
            <br />
            <small>error {meters(result.rebased.separationError)}</small>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function ExperimentsPanel() {
  const [experimentId, setExperimentId] = useState(BUILT_IN_EXPERIMENTS[0]?.id ?? '');
  const [result, setResult] = useState<ExperimentResult | undefined>(() =>
    BUILT_IN_EXPERIMENTS[0] === undefined ? undefined : runExperiment(BUILT_IN_EXPERIMENTS[0]),
  );
  const [running, setRunning] = useState(false);

  const run = (id: string): void => {
    setRunning(true);
    // Yield once so the button state paints before a long run blocks the thread.
    // The runner is already chunk- and Worker-ready; moving it off the main
    // thread is milestone 9's job, not a rewrite.
    setTimeout(() => {
      setResult(runExperiment(requireExperiment(id)));
      setRunning(false);
    }, 0);
  };

  return (
    <>
      <section className="panel">
        <h3>Representation drift</h3>
        <div className="field">
          <label htmlFor="experiment">Experiment</label>
          <select
            id="experiment"
            value={experimentId}
            onChange={(event) => {
              setExperimentId(event.target.value);
              run(event.target.value);
            }}
          >
            {BUILT_IN_EXPERIMENTS.map((experiment) => (
              <option key={experiment.id} value={experiment.id}>
                {experiment.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => run(experimentId)} disabled={running}>
            {running ? 'Running…' : 'Run again'}
          </button>
        </div>
        {result !== undefined && <ExperimentReadout result={result} />}
      </section>

      <section className="panel">
        <h3>Floating origin rescues the millimetre</h3>
        <FloatingOriginReadout />
        <p className="lens-question">
          The same binary64, the same two points. Only the coordinate strategy changed. Finite
          precision failing is half the lesson; the other half is that software chooses how to spend
          it.
        </p>
      </section>
    </>
  );
}
