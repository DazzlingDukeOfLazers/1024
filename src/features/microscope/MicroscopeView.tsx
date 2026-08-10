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
  gapsAcrossMagnitudes,
  planckLatticeReport,
  q128LatticeReport,
  representabilityAtBaseUnit,
  SUBNORMAL_INSET_DOMAIN,
} from './lattice';
import { PickYourRuler } from './PickYourRuler';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';
import { type Rect, chooseClearRect, estimateTextWidth } from '../../camera/labels';

const UNIT_CHOICES = ['fm', 'pm', 'nm', 'µm', 'mm', 'm', 'km', 'Mm', 'Gm', 'au', 'ly'];

const NOMINAL_LATTICE_WIDTH = 760;
const LATTICE_HEIGHT = 64;
const LATTICE_MARGIN = 30;

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

/**
 * Beyond this many characters an exact decimal stops being a number you read
 * and becomes a wall you scroll past.
 *
 * Measured rather than picked: `1` and `3` are 1 character, `0.1` is 57 — the
 * famous one, 0.1000000000000000055511151231257827…, which has to stay in
 * plain sight because it is the whole demonstration. `10^-40` is 185 and a
 * subnormal near `10^-310` is **1076**, which on a 420 px screen is forty lines
 * of mostly zeros pushing the quantization, the gaps and the regime row off the
 * bottom of the panel.
 */
const INLINE_DECIMAL_LIMIT = 120;

/**
 * The exact decimal, entire, and folded away when it is too long to read.
 *
 * Nothing is truncated and nothing is rounded — `toExactDecimalString` already
 * refuses to do either, returning `undefined` for a repeating expansion rather
 * than cutting one short, and this keeps that promise. The digits are all there
 * behind one click.
 *
 * The length is worth saying out loud in its own right. "1076 digits" is a fact
 * about what it costs to write a subnormal exactly, and it was invisible before
 * — buried in the thousand digits that were the answer to it.
 */
function ExactDecimal({ text }: { text: string | undefined }) {
  if (text === undefined) return <small>no finite decimal expansion</small>;
  if (text.length <= INLINE_DECIMAL_LIMIT) return <small>{text}</small>;
  return (
    <details>
      <summary>
        <small>exactly {text.length.toLocaleString()} characters — show them</small>
      </summary>
      <small>{text}</small>
    </details>
  );
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
                  <ExactDecimal text={exactDecimal} />
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
const LEGEND_FONT_SIZE = 11;

function ResolutionChart({
  profiles,
  referenceLog10,
  label,
}: {
  profiles: readonly ResolutionProfile[];
  referenceLog10: number | undefined;
  /**
   * The accessible name. Required rather than defaulted, because the moment
   * there were two of these charts they announced themselves identically —
   * a listener would have been told "Local resolution against magnitude" twice
   * and given no way to tell which decades each covered. Two Playwright
   * selectors broke on the duplicate before anyone could have heard it.
   */
  label: string;
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

  // Where the legend goes is measured rather than assumed. It used to sit in
  // the top right under a translucent backing, which is where binary64's line
  // arrives — so the line ran through the words and the backing only made them
  // legible rather than unobstructed. The four corners are offered in order of
  // preference and the emptiest wins.
  const plotted = profiles.map((profile) =>
    profile.samples
      .filter((sample) => sample.log10Gap !== undefined)
      .map((sample) => ({ x: x(sample.log10Magnitude), y: y(sample.log10Gap!) })),
  );
  const legendLabels = profiles.map(
    (profile) =>
      `${profile.label} (${profile.behaviour ?? (profile.constant ? 'constant' : 'grows')})`,
  );
  const legendWidth =
    Math.max(...legendLabels.map((label) => estimateTextWidth(label, LEGEND_FONT_SIZE))) + 8;
  const legendHeight = profiles.length * 15 + 4;
  const legendCorners: Rect[] = [
    {
      x: CHART_WIDTH - CHART_PAD - legendWidth,
      y: CHART_PAD + 3,
      width: legendWidth,
      height: legendHeight,
    },
    { x: CHART_PAD + 6, y: CHART_PAD + 3, width: legendWidth, height: legendHeight },
    {
      x: CHART_WIDTH - CHART_PAD - legendWidth,
      y: CHART_HEIGHT - CHART_PAD - legendHeight - 3,
      width: legendWidth,
      height: legendHeight,
    },
    {
      x: CHART_PAD + 6,
      y: CHART_HEIGHT - CHART_PAD - legendHeight - 3,
      width: legendWidth,
      height: legendHeight,
    },
  ];
  const legend = legendCorners[chooseClearRect(legendCorners, plotted)]!;

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={label}
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

        {profiles.map((profile) => {
          const points = profile.samples
            .filter((sample) => sample.log10Gap !== undefined)
            .map((sample) => `${x(sample.log10Magnitude)},${y(sample.log10Gap!)}`)
            .join(' ');
          return (
            <polyline
              key={profile.id}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.85}
              strokeWidth={2}
              strokeDasharray={profile.constant ? '6 4' : undefined}
            />
          );
        })}

        {/* The legend last, so it is never under a polyline drawn after it —
            interleaving is what once put a label beneath the next profile's
            line. It still carries a backing, but now as insurance rather than
            as the fix: `chooseClearRect` put the block in a corner no line
            reaches, and the backing only covers the axis rule if a chart ever
            arrives with all four corners crossed. */}
        {profiles.map((profile, index) => (
          <g key={`legend-${profile.id}`}>
            <rect
              x={legend.x}
              y={legend.y + index * 15}
              width={legend.width}
              height={14}
              fill="var(--panel)"
              fillOpacity={0.85}
              rx={2}
            />
            <text
              x={legend.x + legend.width - 4}
              y={legend.y + index * 15 + 11}
              fontSize={LEGEND_FONT_SIZE}
              textAnchor="end"
              fill="currentColor"
            >
              {legendLabels[index]}
            </text>
          </g>
        ))}
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
  // The subnormal inset. binary64 only, and the domain straddles the smallest
  // normal at 10^-307.65 so the knee sits well inside the picture rather than
  // against an edge: flat for the left 58% of it, climbing after.
  const subnormalProfiles = defaultProfiles(
    preset,
    SUBNORMAL_INSET_DOMAIN.from,
    SUBNORMAL_INSET_DOMAIN.to,
  )
    .filter((profile) => profile.id === 'binary64')
    // "grows" is true of binary64 everywhere else and false of the left half of
    // this picture, which is the only reason the picture is here.
    .map((profile) => ({ ...profile, behaviour: 'flat, then grows' }));
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

          {/* CLAUDE.md required experiments 7 and 9. Both are comparisons, and
              a comparison shown one value at a time is not one — the machinery
              was here and the lesson was not. */}
          <section className="panel">
            <h3>Which of these can it hold exactly?</h3>
            <table className="readout">
              <thead>
                <tr>
                  <th scope="col">Value</th>
                  <th scope="col">Q128.128 @ {Q128_128_PRESETS[preset].baseUnitLabel}</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {representabilityAtBaseUnit(Q128_128_PRESETS[preset]).map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="mono">
                      {row.exact ? (
                        <span className="tag tag-exact">exact</span>
                      ) : (
                        <span className="tag tag-rounded">quantized</span>
                      )}
                    </td>
                    <td className="mono">
                      {row.quantizationError === undefined || isZero(row.quantizationError)
                        ? '—'
                        : meters(row.quantizationError)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lens-question">
              At <strong>@m</strong> only the powers of two land: a half is free because the base is
              two, and a tenth is impossible however many bits you spend. Switch the machine to{' '}
              <strong>@mm</strong> and all five become exact — a metre is 1000 machine units, a
              centimetre is 10 — because the base unit moved, not the digits.
            </p>
          </section>

          <section className="panel">
            <h3>How far apart are binary64&rsquo;s numbers?</h3>
            <table className="readout">
              <thead>
                <tr>
                  <th scope="col">Near</th>
                  <th scope="col">Gap below</th>
                  <th scope="col">Gap above</th>
                </tr>
              </thead>
              <tbody>
                {gapsAcrossMagnitudes().map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="mono">
                      {row.gapBelow === undefined ? 'undefined here' : meters(row.gapBelow)}
                    </td>
                    <td className="mono">
                      {row.gapAbove === undefined ? 'undefined here' : meters(row.gapAbove)}
                      {row.asymmetric && <span className="tag tag-rounded">asymmetric</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lens-question">
              At zero the neighbours are 5 × 10^-324 m away; at 10^20 m they are sixteen kilometres
              away. Same 64 bits. One metre is a power of two, so its neighbours sit at different
              distances — the grid below it is twice as fine as the grid above.
            </p>
          </section>

          <section className="panel">
            <h3>Local resolution against magnitude</h3>
            <ResolutionChart
              profiles={profiles}
              referenceLog10={referenceLog10}
              label="Local resolution against magnitude"
            />
            <p className="lens-question">
              binary64&rsquo;s spacing climbs a decade for every decade of magnitude; a fixed-point
              machine&rsquo;s does not move. Where the lines cross is worth noticing — far below a
              zeptometre, the float is the finer of the two. Neither representation is simply
              better; each one chooses which numbers are convenient.
            </p>

            {/* The chart above runs to 10^-40, and the most interesting thing
                binary64 does is 268 decades further left. Widening the main
                domain to reach it would squash the part that is about metres
                into a few pixels, so it gets its own axes instead. */}
            <h4>…and 270 decades further left, where it stops climbing</h4>
            <ResolutionChart
              profiles={subnormalProfiles}
              referenceLog10={undefined}
              // Deliberately not "Local resolution against magnitude, below
              // …". Accessible-name matching is by substring in most tooling,
              // so a name that starts with the other chart's name is still
              // ambiguous to anything looking one up — which is exactly how
              // this broke a second time after the labels were made distinct.
              label={
                `Resolution below the smallest normal, ` +
                `10^${SUBNORMAL_INSET_DOMAIN.from} to 10^${SUBNORMAL_INSET_DOMAIN.to} metres`
              }
            />
            <p className="lens-question">
              Below 2^-1022 — about 10^-308 m — binary64&rsquo;s exponent has bottomed out. The
              significand shrinks on its own, every remaining value is a multiple of one fixed
              quantum, and the line goes flat:{' '}
              <strong>down here binary64 is a fixed-point machine</strong>, which is the thing this
              lens once claimed the opposite of. The knee is the smallest normal.
            </p>
            <p className="lens-question">
              Only binary64 is drawn. The fixed-point machines are flat here too, at 10^-38.5 m and
              10^-34.8 m — roughly 285 decades coarser than the line shown — so drawing them would
              compress this whole picture into the bottom ninth of the box and hide the one shape it
              exists for. They are stated instead, which is the same choice the drift sparklines
              make: numbers carry a comparison across 285 decades, and pixels do not.
            </p>
          </section>
        </>
      )}
    </>
  );
}
