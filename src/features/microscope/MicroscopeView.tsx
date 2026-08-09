/**
 * The Numerical Microscope.
 *
 * docs/UI_SPEC.md §4: "What numbers can this representation see here?"
 *
 * Each representation's lattice is drawn at *its own* scale, and each row says
 * what that scale is. Drawing them on one shared scale would be dishonest —
 * Q128.128's grid at metre base unit is twenty-three decades finer than
 * binary64's near 1 m, so one of the two would always be an invisible smear.
 */

import { type Rational, ZERO, div, isZero, sub } from '../../core/rational/rational';
import { toNumberForDisplay } from '../../core/rational/log10';
import { parseDecimalExact } from '../../core/rational/parse';
import { quantity, fromUnit } from '../../core/quantities/quantity';
import { formatCount, formatEngineering, formatScientific } from '../../core/units/format';
import { toExactDecimalString } from '../../core/rational/decimal';
import { metersToPlanckLengths } from '../../core/representations/planck';
import { Q128_128_PRESETS, type Q128_128PresetName } from '../../core/representations/q128_128';
import { type MicroscopeState, type RepresentationState } from '../../share/appState';
import {
  type LatticeReport,
  type ResolutionProfile,
  binary64LatticeReport,
  defaultProfiles,
  planckLatticeReport,
  q128LatticeReport,
} from './lattice';
import { PickYourRuler } from './PickYourRuler';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const UNIT_CHOICES = ['fm', 'pm', 'nm', 'µm', 'mm', 'm', 'km', 'Mm', 'Gm', 'au', 'ly'];

const NOMINAL_LATTICE_WIDTH = 760;
const LATTICE_HEIGHT = 64;
const LATTICE_MARGIN = 30;

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

/* -------------------------------------------------------------------------- */
/* One representation's lattice                                                */
/* -------------------------------------------------------------------------- */

function LatticeRow({ report }: { report: LatticeReport }) {
  // Measured, like the Ruler and the Atlas. On a fixed 760-unit viewBox scaled
  // into 340 px, a 10 px label draws at about four and a half — not small, just
  // unreadable.
  const [LATTICE_WIDTH, measure] = useMeasuredWidth(NOMINAL_LATTICE_WIDTH);
  const LATTICE_TRACK = LATTICE_WIDTH - LATTICE_MARGIN * 2;

  const samples = report.samples;
  const first = samples[0]?.value;
  const last = samples.at(-1)?.value;
  const span = first === undefined || last === undefined ? undefined : sub(last, first);

  /**
   * Positions come from the exact values, reduced to a fraction of the track
   * before anything becomes a number. Uneven spacing therefore shows up as
   * uneven spacing, which is the point at a power-of-two boundary.
   */
  const xOf = (value: Rational): number => {
    if (first === undefined || span === undefined || isZero(span)) return LATTICE_WIDTH / 2;
    return LATTICE_MARGIN + toNumberForDisplay(div(sub(value, first), span)) * LATTICE_TRACK;
  };

  const requestedInSpan =
    first !== undefined &&
    last !== undefined &&
    report.requested.numerator * first.denominator >=
      first.numerator * report.requested.denominator &&
    report.requested.numerator * last.denominator <= last.numerator * report.requested.denominator;

  const exactDecimal =
    report.nearest === undefined ? undefined : toExactDecimalString(report.nearest);

  return (
    <section className="panel" ref={measure}>
      <h3>{report.label}</h3>

      {samples.length === 0 ? (
        <p className="error">{report.note}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${LATTICE_WIDTH} ${LATTICE_HEIGHT}`}
            width="100%"
            role="img"
            aria-label={`${report.label} representable values`}
          >
            <line
              x1={LATTICE_MARGIN}
              y1={34}
              x2={LATTICE_WIDTH - LATTICE_MARGIN}
              y2={34}
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            {samples.map((sample) => (
              <g key={sample.index}>
                <line
                  x1={xOf(sample.value)}
                  y1={sample.index === 0 ? 18 : 24}
                  x2={xOf(sample.value)}
                  y2={sample.index === 0 ? 50 : 44}
                  stroke="currentColor"
                  strokeOpacity={sample.index === 0 ? 1 : 0.55}
                  strokeWidth={sample.index === 0 ? 2 : 1}
                />
                <circle
                  cx={xOf(sample.value)}
                  cy={34}
                  r={sample.index === 0 ? 4 : 2.5}
                  fill="currentColor"
                  fillOpacity={sample.index === 0 ? 1 : 0.5}
                />
              </g>
            ))}
            {requestedInSpan && (
              <>
                <line
                  x1={xOf(report.requested)}
                  y1={10}
                  x2={xOf(report.requested)}
                  y2={58}
                  stroke="currentColor"
                  strokeOpacity={0.85}
                  strokeDasharray="3 3"
                />
                <text x={xOf(report.requested) + 4} y={12} fontSize={10} fill="currentColor">
                  asked for
                </text>
              </>
            )}
          </svg>

          <table className="readout">
            <tbody>
              <tr>
                <th scope="row">Nearest it can hold</th>
                <td className="mono">
                  {meters(report.nearest!)}
                  <br />
                  <small>{exactDecimal ?? 'no finite decimal expansion'}</small>
                </td>
              </tr>
              <tr>
                <th scope="row">Quantization</th>
                <td className="mono">
                  {isZero(report.quantizationError ?? ZERO) ? (
                    <span className="tag tag-exact">exact</span>
                  ) : (
                    <>
                      {meters(report.quantizationError!)}
                      <br />
                      <small>
                        {formatCount(metersToPlanckLengths(report.quantizationError!)).text} lP
                      </small>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Gap below</th>
                <td className="mono">
                  {report.gapBelow === undefined ? 'undefined here' : meters(report.gapBelow)}
                </td>
              </tr>
              <tr>
                <th scope="row">Gap above</th>
                <td className="mono">
                  {report.gapAbove === undefined ? 'undefined here' : meters(report.gapAbove)}
                  {report.asymmetric && <span className="tag tag-rounded">asymmetric</span>}
                </td>
              </tr>
              {/* Not a footnote. In this range binary64 is a different kind of
                  machine, and the lens is named after asking which one you are
                  looking at. */}
              {report.subnormal === true && (
                <tr>
                  <th scope="row">Regime</th>
                  <td className="mono">
                    subnormal <span className="tag tag-rounded">fixed spacing</span>
                    <br />
                    <small>
                      every value here is a multiple of {meters(report.constantSpacing!)}
                    </small>
                  </td>
                </tr>
              )}
              <tr>
                <th scope="row">Raw register</th>
                <td className="mono">{report.raw ?? '—'}</td>
              </tr>
            </tbody>
          </table>

          <p className="lens-question">{report.note}</p>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Resolution against magnitude                                                */
/* -------------------------------------------------------------------------- */

const NOMINAL_CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const CHART_PAD = 40;

function ResolutionChart({
  profiles,
  referenceLog10,
}: {
  profiles: readonly ResolutionProfile[];
  referenceLog10: number | undefined;
}) {
  // Measured, for the same reason as the lattices: the legend and the axis
  // labels have to be readable at whatever width the chart is given.
  const [CHART_WIDTH, measure] = useMeasuredWidth(NOMINAL_CHART_WIDTH);

  const all = profiles.flatMap((profile) =>
    profile.samples
      .map((sample) => sample.log10Gap)
      .filter((gap): gap is number => gap !== undefined),
  );
  if (all.length === 0) return null;

  const xs = profiles[0]!.samples.map((sample) => sample.log10Magnitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...all);
  const maxY = Math.max(...all);

  const x = (value: number) =>
    CHART_PAD + ((value - minX) / (maxX - minX)) * (CHART_WIDTH - CHART_PAD * 2);
  const y = (value: number) =>
    CHART_HEIGHT - CHART_PAD - ((value - minY) / (maxY - minY)) * (CHART_HEIGHT - CHART_PAD * 2);

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label="Local resolution against magnitude"
      >
        <line
          x1={CHART_PAD}
          y1={CHART_HEIGHT - CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y2={CHART_HEIGHT - CHART_PAD}
          stroke="currentColor"
          strokeOpacity={0.5}
        />
        <line
          x1={CHART_PAD}
          y1={CHART_PAD}
          x2={CHART_PAD}
          y2={CHART_HEIGHT - CHART_PAD}
          stroke="currentColor"
          strokeOpacity={0.5}
        />
        <text
          x={CHART_WIDTH - CHART_PAD}
          y={CHART_HEIGHT - 12}
          fontSize={10}
          textAnchor="end"
          fill="currentColor"
        >
          magnitude, 10^{maxX} m
        </text>
        <text x={CHART_PAD} y={CHART_HEIGHT - 12} fontSize={10} fill="currentColor">
          10^{minX} m
        </text>
        <text x={4} y={CHART_PAD - 8} fontSize={10} fill="currentColor">
          local spacing, 10^{Math.round(maxY)} m
        </text>
        <text x={4} y={CHART_HEIGHT - CHART_PAD + 14} fontSize={10} fill="currentColor">
          10^{Math.round(minY)} m
        </text>

        {referenceLog10 !== undefined && referenceLog10 >= minX && referenceLog10 <= maxX && (
          <line
            x1={x(referenceLog10)}
            y1={CHART_PAD}
            x2={x(referenceLog10)}
            y2={CHART_HEIGHT - CHART_PAD}
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeDasharray="3 3"
          />
        )}

        {profiles.map((profile, index) => {
          const points = profile.samples
            .filter((sample) => sample.log10Gap !== undefined)
            .map((sample) => `${x(sample.log10Magnitude)},${y(sample.log10Gap!)}`)
            .join(' ');
          return (
            <g key={profile.id}>
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.85}
                strokeWidth={2}
                strokeDasharray={profile.constant ? '6 4' : undefined}
              />
              <text
                x={CHART_WIDTH - CHART_PAD - 4}
                y={CHART_PAD + 14 + index * 14}
                fontSize={11}
                textAnchor="end"
                fill="currentColor"
              >
                {profile.label}
                {profile.constant ? ' (constant)' : ' (grows)'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The lens                                                                    */
/* -------------------------------------------------------------------------- */

export interface MicroscopeViewProps {
  state: MicroscopeState;
  onChange: (update: (current: MicroscopeState) => MicroscopeState) => void;
  representations: RepresentationState;
  onRepresentationsChange: (update: (current: RepresentationState) => RepresentationState) => void;
}

export function MicroscopeView({
  state,
  onChange,
  representations,
  onRepresentationsChange,
}: MicroscopeViewProps) {
  const parsed = (() => {
    try {
      return {
        value: fromUnit(parseDecimalExact(state.literal), state.unit).value,
        error: undefined,
      };
    } catch (error) {
      return { value: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  })();

  const preset: Q128_128PresetName = representations.q128Preset;
  const reference = parsed.value;
  const profiles = defaultProfiles(preset);
  const referenceLog10 =
    reference === undefined || isZero(reference) || reference.numerator < 0n
      ? undefined
      : toNumberForDisplay(reference) === 0
        ? undefined
        : Math.log10(Math.abs(toNumberForDisplay(reference)));

  return (
    <>
      <section className="panel">
        <h3>Reference magnitude</h3>
        <div className="field">
          <label htmlFor="microscope-value">Value</label>
          <input
            id="microscope-value"
            value={state.literal}
            onChange={(event) =>
              onChange((current) => ({ ...current, literal: event.target.value }))
            }
            size={16}
          />
          <label htmlFor="microscope-unit">Unit</label>
          <select
            id="microscope-unit"
            value={state.unit}
            onChange={(event) => onChange((current) => ({ ...current, unit: event.target.value }))}
          >
            {UNIT_CHOICES.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
          <label htmlFor="microscope-preset">Q128.128 base unit</label>
          <select
            id="microscope-preset"
            value={preset}
            onChange={(event) =>
              onRepresentationsChange(() => ({
                q128Preset: event.target.value as Q128_128PresetName,
              }))
            }
          >
            {Object.keys(Q128_128_PRESETS).map((name) => (
              <option key={name} value={name}>
                @ {name}
              </option>
            ))}
          </select>
        </div>

        {parsed.error !== undefined && <p className="error">{parsed.error}</p>}
        {reference !== undefined && (
          <p className="lens-question">
            Looking at {formatEngineering(quantity('length', reference)).text}. Each lattice below
            is drawn at its own scale — the machines differ by more decades than one picture could
            hold.
          </p>
        )}
      </section>

      {reference !== undefined && (
        <>
          <LatticeRow report={binary64LatticeReport(reference, 4)} />
          <LatticeRow report={q128LatticeReport(Q128_128_PRESETS[preset], reference, 4)} />
          <LatticeRow report={planckLatticeReport(reference, 4)} />

          <section className="panel">
            <h3>Same 256 bits. Pick your ruler.</h3>
            <PickYourRuler
              meters={reference}
              preset={preset}
              onPresetChange={(next) => onRepresentationsChange(() => ({ q128Preset: next }))}
            />
            <p className="lens-question">
              Every row is the same 256-bit register. A smaller base unit buys resolution and spends
              range; a larger one does the reverse. The machine base unit is not the display unit.
            </p>
          </section>

          <section className="panel">
            <h3>Local resolution against magnitude</h3>
            <ResolutionChart profiles={profiles} referenceLog10={referenceLog10} />
            <p className="lens-question">
              binary64&rsquo;s spacing climbs a decade for every decade of magnitude; a fixed-point
              machine&rsquo;s does not move. Where the lines cross is worth noticing — far below a
              zeptometre, the float is the finer of the two. Neither representation is simply
              better; each one chooses which numbers are convenient.
            </p>
          </section>
        </>
      )}
    </>
  );
}
