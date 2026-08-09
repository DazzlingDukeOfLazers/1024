/**
 * The Representation Lab.
 *
 * docs/UI_SPEC.md §5: run the same calculation through several computers and
 * watch them disagree. A row per representation, a timeline of the run, error
 * split by category, the raw register contents, and Zoom to Disagreement with
 * its magnification always disclosed.
 */

import { useEffect, useRef, useState } from 'react';
import { type Rational, isZero } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatCount, formatScientific } from '../../core/units/format';
import { type Viewport } from '../../camera/camera';
import { BUILT_IN_EXPERIMENTS } from '../../core/experiments/fixtures';
import {
  type ExperimentResult,
  type MachineResult,
  runExperiment,
} from '../../core/experiments/runner';
import {
  ExperimentCancelled,
  type RunHandle,
  type RunProgress,
  runExperimentInWorker,
} from '../../workers/experimentClient';
import { readAccumulator } from '../../core/representations/q512_512';
import { metersToPlanckLengths } from '../../core/representations/planck';
import { relativeError } from '../../core/representations/binary64';
import { buildDisagreementView, drawnSeparationPixels } from './disagreement';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const STRIP: Viewport = { widthPx: 820, heightPx: 96 };
const ROW_Y = 46;

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

function inPlanckLengths(value: Rational): string {
  return isZero(value) ? '0' : `${formatCount(metersToPlanckLengths(value)).text} lP`;
}

/* -------------------------------------------------------------------------- */
/* Zoom to disagreement                                                        */
/* -------------------------------------------------------------------------- */

function DisagreementStrip({
  result,
  zoomed,
  onToggle,
}: {
  result: ExperimentResult;
  zoomed: boolean;
  onToggle: (zoomed: boolean) => void;
}) {
  // Measured, like every other view that states a figure in pixels: this one
  // discloses its magnification and how far apart the machines are *drawn*, and
  // both are lies on any screen that is not the nominal width.
  const [width, measure] = useMeasuredWidth(STRIP.widthPx);
  const strip: Viewport = { widthPx: width, heightPx: STRIP.heightPx };

  const view = buildDisagreementView(
    result.exactFinal,
    result.machines.map((machine) => ({
      id: machine.id,
      label: machine.label,
      decoded: machine.final.decoded,
    })),
    strip,
    zoomed,
  );
  const separation = drawnSeparationPixels(view);

  return (
    <section className="panel" ref={measure}>
      <h3>Zoom to disagreement</h3>

      <div className="field">
        <button type="button" onClick={() => onToggle(!zoomed)} disabled={view.agreed}>
          {zoomed ? 'Back to true scale' : 'Zoom to disagreement'}
        </button>
        {view.agreed && <span className="share-hint">every machine landed on the exact value</span>}
      </div>

      {/* The disclosure is not decoration. Without it a 10^15x exaggeration
          reads as a large physical error, which is the opposite of the point. */}
      {view.magnified ? (
        <p className="magnification-disclosure" role="status">
          Numerical separation magnified {formatCount(view.magnification, 3).text}× for visibility.
          The widest divergence is {meters(view.maxDivergence)} — about{' '}
          {inPlanckLengths(view.maxDivergence)}.
        </p>
      ) : (
        <p className="lens-question">
          Drawn at true scale.{' '}
          {view.agreed
            ? 'Nothing to separate.'
            : 'The machines are drawn where they actually are, which is on top of each other.'}
        </p>
      )}

      <svg
        viewBox={`0 0 ${strip.widthPx} ${strip.heightPx}`}
        width="100%"
        role="img"
        aria-label="Representation divergence"
      >
        <line
          x1={0}
          y1={ROW_Y}
          x2={strip.widthPx}
          y2={ROW_Y}
          stroke="currentColor"
          strokeOpacity={0.3}
        />
        <line
          x1={view.exactX}
          y1={ROW_Y - 20}
          x2={view.exactX}
          y2={ROW_Y + 20}
          stroke="currentColor"
          strokeOpacity={0.9}
        />
        <text x={view.exactX + 5} y={ROW_Y - 24} fontSize={11} fill="currentColor">
          exact
        </text>

        {view.points.map((point, index) =>
          point.x === undefined || point.offScreen ? (
            <text
              key={point.id}
              x={8}
              y={ROW_Y + 24 + index * 14}
              fontSize={10}
              fill="currentColor"
            >
              {point.label} — off scale
            </text>
          ) : (
            <g key={point.id}>
              <circle cx={point.x} cy={ROW_Y} r={5} fill="currentColor" fillOpacity={0.6} />
              <text
                x={point.x}
                y={ROW_Y + 20 + (index % 2) * 14}
                fontSize={10}
                textAnchor="middle"
                fill="currentColor"
                fillOpacity={0.85}
              >
                {point.label}
              </text>
            </g>
          ),
        )}
      </svg>

      <p className="lens-question">
        {separation < 1
          ? 'At this scale every representation occupies the same pixel.'
          : `Drawn ${Math.round(separation)} px apart.`}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-representation error metrics                                            */
/* -------------------------------------------------------------------------- */

function MachineDetail({ machine, exact }: { machine: MachineResult; exact: Rational }) {
  const ledger = machine.ledger;
  const relative =
    machine.final.decoded === undefined ? undefined : relativeError(machine.final.decoded, exact);

  return (
    <table className="readout">
      <tbody>
        <tr>
          <th scope="row">Current divergence</th>
          <td className="mono">
            {meters(ledger.currentSignedDivergence)}
            <br />
            <small>{inPlanckLengths(ledger.currentSignedDivergence)}</small>
          </td>
        </tr>
        <tr>
          <th scope="row">Relative error</th>
          <td className="mono">
            {relative === undefined ? 'undefined at zero reference' : formatCount(relative, 4).text}
          </td>
        </tr>
        <tr>
          <th scope="row">Inherited from earlier steps</th>
          <td className="mono">{meters(ledger.currentSignedInheritedPropagation)}</td>
        </tr>
        <tr>
          <th scope="row">Operand encoding</th>
          <td className="mono">
            this step {meters(ledger.exactSignedOperandEncodingContribution)}
            <br />
            <small>
              cumulative absolute {meters(ledger.cumulativeAbsoluteOperandEncodingContribution)}
            </small>
          </td>
        </tr>
        <tr>
          <th scope="row">Operation rounding</th>
          <td className="mono">
            this step {meters(ledger.exactSignedOperationRoundingError)}
            <br />
            <small>
              cumulative absolute {meters(ledger.cumulativeAbsoluteOperationRoundingError)}
              {machine.absoluteRoundingIsLowerBound && ' (lower bound)'}
            </small>
          </td>
        </tr>
        <tr>
          <th scope="row">Q512.512 meters</th>
          <td className="mono">
            signed {meters(readAccumulator(ledger.q512_512SignedAccumulator))}
            <br />
            <small>
              absolute {meters(readAccumulator(ledger.q512_512AbsoluteAccumulator))} — exact total{' '}
              {meters(ledger.cumulativeSignedIntroducedError)}
            </small>
          </td>
        </tr>
        <tr>
          <th scope="row">Raw register</th>
          <td className="mono">{machine.rawState ?? '—'}</td>
        </tr>
        <tr>
          <th scope="row">Machine</th>
          <td className="mono">
            {machine.description.widthBits ?? '?'} bits
            {machine.description.resolution !== undefined &&
              `, resolution ${meters(machine.description.resolution)}`}
            {machine.description.note !== undefined && (
              <>
                <br />
                <small>{machine.description.note}</small>
              </>
            )}
          </td>
        </tr>
        {machine.events.length > 0 && (
          <tr>
            <th scope="row">Events</th>
            <td className="mono">
              {machine.events.map((event, index) => (
                <div key={index}>{event.detail}</div>
              ))}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------------------- */
/* The lab                                                                     */
/* -------------------------------------------------------------------------- */

export interface RepresentationLabProps {
  experimentId: string;
  onExperimentChange: (id: string) => void;
  zoomToDisagreement: boolean;
  onZoomChange: (zoomed: boolean) => void;
}

export function RepresentationLab({
  experimentId,
  onExperimentChange,
  zoomToDisagreement,
  onZoomChange,
}: RepresentationLabProps) {
  const [result, setResult] = useState<ExperimentResult | undefined>(undefined);
  const [progress, setProgress] = useState<RunProgress | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [runToken, setRunToken] = useState(0);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const handleRef = useRef<RunHandle | undefined>(undefined);

  const definition = BUILT_IN_EXPERIMENTS.find((entry) => entry.id === experimentId);

  // A million steps is about a second and a half of solid BigInt arithmetic.
  // On the main thread that was a frozen tab; in a worker it is a progress
  // count, and changing experiment mid-run cancels the old one by terminating
  // it — safe, because the runner has no side effects to unwind.
  useEffect(() => {
    if (definition === undefined) return undefined;

    // Starting a worker is exactly the "synchronising with an external system"
    // case effects exist for, and the run has to be marked in flight the moment
    // it starts. The one extra render pass that costs is worth the tab not
    // freezing for a second and a half.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(true);
    setProgress(undefined);
    setFailure(undefined);

    let handle: RunHandle;
    try {
      handle = runExperimentInWorker(definition, {
        chunkSize: 100_000,
        onProgress: setProgress,
      });
    } catch {
      // No worker available: still give an answer rather than a blank panel.
      setResult(runExperiment(definition));
      setRunning(false);
      return undefined;
    }

    handleRef.current = handle;

    // Two different things cancel a run: the user clicking Cancel, and this
    // effect tearing down because the experiment changed. The first must clear
    // the running flag; the second must not, because a newer run has already
    // set it. Without the distinction the panel sticks on "Running…" forever.
    let superseded = false;

    handle.result
      .then((next) => {
        if (superseded) return;
        setResult(next);
        setRunning(false);
      })
      .catch((reason: unknown) => {
        if (superseded) return;
        setRunning(false);
        if (reason instanceof ExperimentCancelled) return;
        setFailure(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      superseded = true;
      handle.cancel();
    };
  }, [definition, runToken]);
  const intervalAccounted =
    result !== undefined && Object.values(result.accounting).includes('interval');

  return (
    <>
      <section className="panel">
        <h3>Abuse the Computer</h3>
        <div className="field">
          <label htmlFor="experiment">Experiment</label>
          <select
            id="experiment"
            value={experimentId}
            onChange={(event) => onExperimentChange(event.target.value)}
          >
            {BUILT_IN_EXPERIMENTS.map((experiment) => (
              <option key={experiment.id} value={experiment.id}>
                {experiment.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRunToken((token) => token + 1)}
            disabled={running}
          >
            {running ? 'Running…' : 'Run again'}
          </button>
          {running && (
            <button type="button" onClick={() => handleRef.current?.cancel()}>
              Cancel
            </button>
          )}
          {running && (
            <span className="share-hint" role="status">
              {progress === undefined
                ? 'starting…'
                : `${progress.iteration.toLocaleString()} of ${progress.count.toLocaleString()} iterations`}
            </span>
          )}
        </div>
        {failure !== undefined && <p className="error">{failure}</p>}
        {definition?.note !== undefined && <p className="lens-question">{definition.note}</p>}

        {result !== undefined && (
          <>
            <table className="readout">
              <thead>
                <tr>
                  <th scope="col">Representation</th>
                  <th scope="col">Result</th>
                  <th scope="col">Divergence</th>
                  <th scope="col">Operations</th>
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
                {result.machines.map((machine) => (
                  <tr key={machine.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className="row-toggle"
                        aria-expanded={expanded === machine.id}
                        onClick={() =>
                          setExpanded(expanded === machine.id ? undefined : machine.id)
                        }
                      >
                        {machine.label}
                      </button>
                    </th>
                    <td className="mono">
                      {machine.final.decoded === undefined ? (
                        <span className="error">no rational value</span>
                      ) : (
                        meters(machine.final.decoded)
                      )}
                    </td>
                    <td className="mono">
                      {machine.final.signedDivergence === undefined ? (
                        '—'
                      ) : isZero(machine.final.signedDivergence) ? (
                        <span className="tag tag-exact">none</span>
                      ) : (
                        meters(machine.final.signedDivergence)
                      )}
                    </td>
                    <td className="mono">{machine.operations.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expanded !== undefined && (
              <div className="machine-detail">
                <h4>{result.machines.find((machine) => machine.id === expanded)?.label}</h4>
                <MachineDetail
                  machine={result.machines.find((machine) => machine.id === expanded)!}
                  exact={result.exactFinal}
                />
              </div>
            )}

            <p className="lens-question">
              Click a representation to see its error split into operand encoding and operation
              rounding. {result.totalOperations.toLocaleString()} real machine operations,{' '}
              {result.samples.length} trace samples.
              {intervalAccounted &&
                ' A long repeat was accounted per checkpoint interval, so the absolute rounding' +
                  ' total is a lower bound where a machine rounds; every other figure is exact.'}
            </p>
          </>
        )}
      </section>

      {result !== undefined && (
        <DisagreementStrip result={result} zoomed={zoomToDisagreement} onToggle={onZoomChange} />
      )}

      {result !== undefined && <Timeline result={result} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

function Timeline({ result }: { result: ExperimentResult }) {
  return (
    <section className="panel">
      <h3>Timeline</h3>
      <table className="readout">
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Exact</th>
            {result.machines.map((machine) => (
              <th key={machine.id} scope="col">
                {machine.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.samples.map((sample, index) => (
            <tr key={index}>
              <th scope="row">
                {sample.iteration === undefined
                  ? `step ${sample.stepIndex + 1}`
                  : `iteration ${sample.iteration.toLocaleString()}`}
              </th>
              <td className="mono">{meters(sample.exact)}</td>
              {result.machines.map((machine) => {
                const entry = sample.machines[machine.id];
                const divergence = entry?.signedDivergence;
                return (
                  <td key={machine.id} className="mono">
                    {divergence === undefined ? (
                      '—'
                    ) : isZero(divergence) ? (
                      <span className="tag tag-exact">0</span>
                    ) : (
                      meters(divergence)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lens-question">
        Divergence from the exact reference at each retained checkpoint. A million-iteration run
        executes every addition but keeps only these samples — the arithmetic is never compact, the
        trace always is.
      </p>
    </section>
  );
}
