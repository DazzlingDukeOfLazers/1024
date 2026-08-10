/**
 * The Architecture Lab.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §22, over the machinery in `core/wide`. The
 * simulator has been complete and oracle-checked for several commits and none
 * of it was visible; this is the picture.
 *
 * Three claims the document makes that a table of numbers states and a drawing
 * shows:
 *
 *   - a wide register is often nearly all zeros (§3, §4);
 *   - a multiply's work is the *non-zero* digits, not the declared width (§4, §6);
 *   - narrowing has a full result, a destination and a residue, and which bits
 *     went where is a policy decision (§8).
 *
 * Every figure stated in pixels here obeys the same rule as the rest of the app:
 * the SVGs measure themselves, so one viewBox unit is one CSS pixel.
 */

import { useMemo } from 'react';
import {
  DIGIT_WIDTHS,
  type DigitProfile,
  type DigitWidth,
  WideError,
  profile,
} from '../../core/wide/digits';
import {
  ACCUMULATE_TENTHS,
  ACCUMULATE_TENTHS_FAR,
  type ComparisonWorkload,
  type RepresentationRun,
  compareRepresentations,
} from '../../core/wide/comparison';
import { type DivisionStep, divRem } from '../../core/wide/divide';
import { describeWideLiteral, parseWideLiteral } from '../../core/wide/parse';
import { isZero } from '../../core/rational/rational';
import { log10RationalForDisplay } from '../../core/rational/log10';
import { formatCount } from '../../core/units/format';
import { Rendered } from '../../ui/Rendered';
import { mulWide } from '../../core/wide/multiply';
import { narrow } from '../../core/wide/narrow';
import { SCENARIOS, SCENARIO_NAMES } from '../../core/wide/scenario';
import { type ArchitectureState } from '../../share/appState';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const REGISTER_BITS = 1024;
/** Half the register, so the operands read as Q512.512 — §7's example scaled up. */
const FRACTION_BITS = 512;
const NOMINAL_WIDTH = 820;
const CHUNK_HEIGHT = 76;
const LABEL_FONT_SIZE = 9;

/* -------------------------------------------------------------------------- */
/* §22: wide number chunks, and the significant band                           */
/* -------------------------------------------------------------------------- */

function ChunkRow({ label, report }: { label: string; report: DigitProfile }) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const count = report.digits.length;
  const gap = 2;
  const cell = Math.max((width - gap * (count - 1)) / count, 1);
  // Highest digit on the left, which is how a register is written.
  const ordered = [...report.digits].reverse();

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${CHUNK_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`${label}: ${report.nonzeroDigits} of ${count} digits carry information`}
      >
        {ordered.map((digit, index) => {
          const x = index * (cell + gap);
          const active = digit !== 0n;
          return (
            <g key={index}>
              <rect
                x={x}
                y={18}
                width={cell}
                height={30}
                rx={2}
                fill="currentColor"
                fillOpacity={active ? 0.55 : 0.08}
                stroke="currentColor"
                strokeOpacity={active ? 0.8 : 0.2}
              />
              {cell > 22 && (
                <text
                  x={x + cell / 2}
                  y={62}
                  fontSize={LABEL_FONT_SIZE}
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity={active ? 0.9 : 0.35}
                >
                  {count - 1 - index}
                </text>
              )}
            </g>
          );
        })}
        <text x={0} y={12} fontSize={LABEL_FONT_SIZE + 1} fill="currentColor" fillOpacity={0.75}>
          {label}
        </text>
        <text
          x={width}
          y={12}
          fontSize={LABEL_FONT_SIZE + 1}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.75}
        >
          {report.significantBits} of {report.declaredBits} bits · {report.path} path
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §21 and §23: where each representation's worst step lands                    */
/* -------------------------------------------------------------------------- */

const SCALE_TOP = 18;
const SCALE_ROW_HEIGHT = 30;
const SCALE_AXIS_HEIGHT = 30;
/** Half the width of a `10^-39` label, so no tick label can leave the box. */
const TICK_LABEL_HALF_WIDTH = 18;

/**
 * The three machines with an error to compare. `exact` is the reference every
 * one of them is measured against, so it has no error to plot and appears in
 * the table as the zero row rather than on the axis.
 */
const COMPARED = [
  { key: 'binary64' as const, label: 'binary64' },
  { key: 'q128.128' as const, label: 'Q128.128' },
  { key: 'wide-fixed-point' as const, label: 'wide fixed point' },
];

interface ScaleRow {
  readonly label: string;
  /** log10 of the worst single-step error, or undefined if there is none to plot. */
  readonly near: number | undefined;
  readonly far: number | undefined;
  /** Shown in place of the markers when there is nothing to place. */
  readonly note: string;
}

/**
 * A log axis with two markers per representation: the accumulation run near
 * zero, and the same accumulation at 10^6 m.
 *
 * The picture is the whole §23 argument. A fixed-point row is a dot inside a
 * ring — the two runs land in the same place, because an absolute quantum does
 * not know where it is. binary64's row is a segment, and its length is what
 * moving six decades from the origin costs.
 */
function ErrorScale({ rows }: { rows: readonly ScaleRow[] }) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const height = SCALE_TOP + rows.length * SCALE_ROW_HEIGHT + SCALE_AXIS_HEIGHT;
  const gutter = Math.min(120, width * 0.28);
  const plotLeft = gutter;
  const plotRight = Math.max(plotLeft + 1, width);
  const axisY = SCALE_TOP + rows.length * SCALE_ROW_HEIGHT;

  const values = rows.flatMap((row) => [row.near, row.far]).filter((v) => v !== undefined);
  // `Math.min()` of nothing is `Infinity`, which would make every coordinate
  // NaN and render an empty box with no hint that anything went wrong. A
  // scenario that traps every row is a reachable state, so it gets an axis.
  const low = values.length === 0 ? -1 : Math.floor(Math.min(...values)) - 1;
  const high = values.length === 0 ? 1 : Math.ceil(Math.max(...values)) + 1;
  const span = Math.max(high - low, 1);
  const x = (value: number) => plotLeft + ((value - low) / span) * (plotRight - plotLeft);

  // At most seven gridlines, whatever the span turns out to be.
  const step = Math.max(1, Math.ceil(span / 7));
  const ticks: number[] = [];
  for (let decade = low; decade <= high; decade += step) ticks.push(decade);

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label="Worst single-step error for each representation, near zero and at ten to the sixth metres"
      >
        {ticks.map((decade) => (
          <g key={decade}>
            <line
              x1={x(decade)}
              y1={SCALE_TOP}
              x2={x(decade)}
              y2={axisY}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={Math.min(
                Math.max(x(decade), TICK_LABEL_HALF_WIDTH),
                width - TICK_LABEL_HALF_WIDTH,
              )}
              y={axisY + 14}
              fontSize={LABEL_FONT_SIZE}
              textAnchor="middle"
              fill="currentColor"
              fillOpacity={0.6}
            >
              10^{decade}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          const centre = SCALE_TOP + index * SCALE_ROW_HEIGHT + SCALE_ROW_HEIGHT / 2;
          return (
            <g key={row.label}>
              <text
                x={0}
                y={centre + 3}
                fontSize={LABEL_FONT_SIZE + 1}
                fill="currentColor"
                fillOpacity={0.8}
              >
                {row.label}
              </text>
              {row.near !== undefined && row.far !== undefined && (
                <line
                  x1={x(row.near)}
                  y1={centre}
                  x2={x(row.far)}
                  y2={centre}
                  stroke="currentColor"
                  strokeOpacity={0.45}
                  strokeWidth={3}
                />
              )}
              {row.near !== undefined && (
                <circle
                  cx={x(row.near)}
                  cy={centre}
                  r={5.5}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.85}
                />
              )}
              {row.far !== undefined && (
                <circle cx={x(row.far)} cy={centre} r={3} fill="currentColor" fillOpacity={0.85} />
              )}
              {row.near === undefined && row.far === undefined && (
                <text
                  x={plotLeft}
                  y={centre + 3}
                  fontSize={LABEL_FONT_SIZE}
                  fill="currentColor"
                  fillOpacity={0.5}
                >
                  {row.note}
                </text>
              )}
            </g>
          );
        })}
        <text x={0} y={12} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.6}>
          worst single step
        </text>
        <text
          x={width}
          y={12}
          fontSize={LABEL_FONT_SIZE}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.6}
        >
          ring: near zero · dot: at 10^6 m
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §22: the multiplication matrix                                              */
/* -------------------------------------------------------------------------- */

function MultiplyMatrix({
  a,
  b,
  skipZeroDigits,
}: {
  a: DigitProfile;
  b: DigitProfile;
  skipZeroDigits: boolean;
}) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const size = a.digits.length;
  const cell = Math.max(Math.min((width - 40) / size, 22), 3);
  // Room for the caption below the grid. Getting this wrong by fourteen pixels
  // put the caption outside the viewBox, where it was clipped in half and the
  // conformance sweep did not notice, because it only checked horizontal bounds.
  const height = cell * size + 30;

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Multiplication matrix, ${size} by ${size} partial products`}
      >
        {a.digits.map((digitA, i) =>
          b.digits.map((digitB, j) => {
            const executed = !skipZeroDigits || (digitA !== 0n && digitB !== 0n);
            return (
              <rect
                key={`${i}-${j}`}
                x={20 + j * cell}
                y={12 + i * cell}
                width={Math.max(cell - 1, 1)}
                height={Math.max(cell - 1, 1)}
                fill="currentColor"
                fillOpacity={executed ? 0.7 : 0.06}
              />
            );
          }),
        )}
        <text x={0} y={height - 4} fontSize={LABEL_FONT_SIZE} fill="currentColor">
          b₀ → b{size - 1} across, a₀ → a{size - 1} down
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §22: narrowing — full result, destination, residue                          */
/* -------------------------------------------------------------------------- */

function NarrowBands({ fullBits, destinationBits }: { fullBits: number; destinationBits: number }) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const kept = fullBits === 0 ? 0 : Math.min(destinationBits / fullBits, 1) * width;

  return (
    <div ref={measure}>
      {/* Labels sit below their bars and inside the box. Putting the first one
          at a baseline of 6 with a 9px font pushed its ascenders above the
          viewBox, where they were clipped. */}
      <svg
        viewBox={`0 0 ${width} 72`}
        width="100%"
        role="img"
        aria-label="Full result, destination and residue"
      >
        <rect x={0} y={4} width={width} height={14} fill="currentColor" fillOpacity={0.25} />
        <text x={0} y={30} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.75}>
          full result — {fullBits} fraction bits
        </text>

        <rect x={0} y={40} width={kept} height={14} fill="currentColor" fillOpacity={0.65} />
        <rect
          x={kept}
          y={40}
          width={Math.max(width - kept, 0)}
          height={14}
          fill="currentColor"
          fillOpacity={0.12}
        />
        <text x={0} y={66} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.75}>
          destination — {destinationBits}
        </text>
        {width - kept > 110 && (
          <text
            x={width}
            y={66}
            fontSize={LABEL_FONT_SIZE}
            textAnchor="end"
            fill="currentColor"
            fillOpacity={0.75}
          >
            residue — {Math.max(fullBits - destinationBits, 0)}
          </text>
        )}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §22: division, one quotient digit at a time                                  */
/* -------------------------------------------------------------------------- */

/** Fraction bits the division panel asks for. §11's scaling, at a legible size. */
const DIVISION_FRACTION_BITS = 16;
/** How many quotient bits are shown around the current one. */
const TAPE_WINDOW = 48;
const TAPE_HEIGHT = 108;

/**
 * The tape head. A digit-serial divider produces one bit per step, and a strip
 * of seven hundred 1.6-pixel cells is a texture rather than a diagram — so this
 * shows the window of bits ending at the current step, the way you would watch
 * the machine, with an overview bar saying where in the run that window is.
 */
function QuotientTape({
  steps,
  position,
  divisor,
}: {
  steps: readonly DivisionStep[];
  position: number;
  divisor: bigint;
}) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const shown = steps.slice(Math.max(0, position - TAPE_WINDOW), position);
  const gap = 2;
  const cell = Math.max((width - gap * (TAPE_WINDOW - 1)) / TAPE_WINDOW, 1);
  const current = position === 0 ? undefined : steps[position - 1];

  // The remainder as a fraction of the divisor. Restoring division keeps it in
  // [0, B), so the bar is the standing proof of that: a bar past the line would
  // mean a quotient digit that should have been produced and was not. Under
  // non-restoring it may go negative, and the bar shows that rather than
  // clamping it away.
  const ratio =
    current === undefined || divisor === 0n
      ? 0
      : Number((current.remainder * 1000n) / divisor) / 1000;
  const barLeft = width / 2;
  const barSpan = width / 2 - 4;

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${TAPE_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Quotient bits ${Math.max(0, position - TAPE_WINDOW)} to ${position} of ${steps.length}, with the remainder held after the last of them`}
      >
        <text x={0} y={12} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.6}>
          quotient bits, most recent on the right
        </text>
        {shown.map((step, index) => {
          const x = (TAPE_WINDOW - shown.length + index) * (cell + gap);
          const last = index === shown.length - 1;
          return (
            <rect
              key={step.index}
              x={x}
              y={20}
              width={cell}
              height={26}
              rx={2}
              fill="currentColor"
              fillOpacity={step.bit ? 0.6 : 0.08}
              stroke="currentColor"
              strokeOpacity={last ? 0.95 : step.bit ? 0.5 : 0.18}
              strokeWidth={last ? 2 : 1}
            />
          );
        })}

        {/* Where the window sits in the whole run. */}
        <rect x={0} y={54} width={width} height={4} rx={2} fill="currentColor" fillOpacity={0.08} />
        {steps.length > 0 && (
          <rect
            x={(Math.max(0, position - TAPE_WINDOW) / steps.length) * width}
            y={54}
            width={Math.max(2, (shown.length / steps.length) * width)}
            height={4}
            rx={2}
            fill="currentColor"
            fillOpacity={0.55}
          />
        )}
        <text x={0} y={76} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.6}>
          step {position} of {steps.length}
        </text>

        <text
          x={barLeft}
          y={76}
          fontSize={LABEL_FONT_SIZE}
          fill="currentColor"
          fillOpacity={0.6}
          textAnchor="start"
        >
          remainder ÷ divisor
        </text>
        <line
          x1={barLeft}
          y1={96}
          x2={barLeft + barSpan}
          y2={96}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <rect
          x={ratio < 0 ? barLeft + barSpan * Math.max(ratio, -1) : barLeft}
          y={84}
          width={Math.max(1, barSpan * Math.min(Math.abs(ratio), 1))}
          height={12}
          rx={2}
          fill="currentColor"
          fillOpacity={ratio < 0 ? 0.3 : 0.55}
        />
        <text
          x={barLeft + barSpan}
          y={80}
          fontSize={LABEL_FONT_SIZE}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.6}
        >
          1
        </text>
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The lens                                                                    */
/* -------------------------------------------------------------------------- */

export interface ArchitectureLabProps {
  state: ArchitectureState;
  onChange: (update: (current: ArchitectureState) => ArchitectureState) => void;
}

export function ArchitectureLab({ state, onChange }: ArchitectureLabProps) {
  const parsed = useMemo(() => {
    try {
      const a = parseWideLiteral(state.aLiteral);
      const b = parseWideLiteral(state.bLiteral);
      const magnitudeA = a < 0n ? -a : a;
      const magnitudeB = b < 0n ? -b : b;
      profile(magnitudeA, state.digitBits, REGISTER_BITS);
      profile(magnitudeB, state.digitBits, REGISTER_BITS);
      return { a, b, error: undefined };
    } catch (error) {
      return {
        a: undefined,
        b: undefined,
        error: error instanceof WideError ? error.message : String(error),
      };
    }
  }, [state.aLiteral, state.bLiteral, state.digitBits]);

  const scenario = SCENARIOS[state.scenario];

  const computed = useMemo(() => {
    if (parsed.a === undefined || parsed.b === undefined) return undefined;
    const magnitudeA = parsed.a < 0n ? -parsed.a : parsed.a;
    const magnitudeB = parsed.b < 0n ? -parsed.b : parsed.b;
    const profileA = profile(magnitudeA, state.digitBits, REGISTER_BITS);
    const profileB = profile(magnitudeB, state.digitBits, REGISTER_BITS);
    const product = mulWide(parsed.a, parsed.b, {
      digitBits: state.digitBits,
      registerBits: REGISTER_BITS,
      skipZeroDigits: state.skipZeroDigits,
    });
    // §7's example is `Q128.128 × Q128.128`, so the operands are read as
    // Q512.512 — the same 1024-bit register, half of it fraction. The product
    // then genuinely has 1024 fraction bits and narrowing back to 512 is a real
    // operation with a real residue.
    //
    // The first version of this panel passed the *width* where the fraction
    // width belonged, shifted away 1024 bits of a 1001-bit product, and reported
    // a destination of 0 with the entire product as residue. Confidently, under
    // a heading. Worth remembering that the numbers were all individually true.
    //
    // A trap is an answer. §14's scenario C exists to refuse a value that is no
    // longer the one that was asked for, and refusing is the machine working.
    // Letting the `WideError` escape put the whole lens behind "Architecture Lab
    // could not be drawn" — a policy the interface offers, taken, and reported
    // as the lens breaking. The lab now says which operation was refused and why
    // and keeps everything that did not depend on it.
    let narrowed: ReturnType<typeof narrow> | undefined;
    let refusal: string | undefined;
    try {
      narrowed = narrow({
        value: product.value,
        sourceFractionBits: FRACTION_BITS * 2,
        sourceWidthBits: REGISTER_BITS * 2,
        destinationFractionBits: FRACTION_BITS,
        destinationWidthBits: REGISTER_BITS,
        policy: { ...scenario.narrowing, range: 'saturate' },
      });
    } catch (error) {
      if (!(error instanceof WideError)) throw error;
      refusal = error.message;
    }
    return { profileA, profileB, product, narrowed, refusal };
  }, [parsed, state.digitBits, state.skipZeroDigits, scenario]);

  /**
   * §22's division: `A / B`, with every intermediate state kept.
   *
   * Dividing by zero has no quotient and no remainder, and the machine says so
   * by throwing. That is correct, and letting it out of here would put the whole
   * lens behind an apology for a value the user is allowed to type — the same
   * mistake the trap scenario made one panel over.
   */
  const division = useMemo(() => {
    if (parsed.a === undefined || parsed.b === undefined) return undefined;
    try {
      return {
        result: divRem({
          dividend: parsed.a,
          divisor: parsed.b,
          fractionBits: DIVISION_FRACTION_BITS,
          trace: true,
        }),
        error: undefined,
      };
    } catch (error) {
      if (!(error instanceof WideError)) throw error;
      return { result: undefined, error: error.message };
    }
  }, [parsed]);

  /**
   * §21's comparison, under whichever scenario is selected. The two workloads
   * differ only in where they start, which is the entire experiment: everything
   * else — the operand, the count, the reference — is held fixed.
   */
  const comparison = useMemo(() => {
    const index = (workload: ComparisonWorkload) =>
      new Map(
        compareRepresentations(workload, { narrowing: scenario.narrowing }).map((run) => [
          run.representation,
          run,
        ]),
      );
    const near = index(ACCUMULATE_TENTHS);
    const far = index(ACCUMULATE_TENTHS_FAR);

    const place = (run: RepresentationRun) =>
      run.final === undefined || isZero(run.worstStepError)
        ? undefined
        : log10RationalForDisplay(run.worstStepError);

    const drift = (run: RepresentationRun) =>
      run.divergence === undefined ? undefined : formatCount(run.divergence);

    return {
      rows: COMPARED.map(({ key, label }) => ({
        label,
        near: place(near.get(key)!),
        far: place(far.get(key)!),
        // Short on purpose. SVG text does not wrap, and the trap message is a
        // full sentence carrying a ninety-bit integer — at 420px it leaves the
        // drawing entirely. The table below wraps, so it carries the detail.
        note:
          near.get(key)!.note === undefined ? 'no step error to place' : 'refused by the policy',
      })),
      table: [{ key: 'exact' as const, label: 'exact' }, ...COMPARED].map(({ key, label }) => ({
        label,
        near: drift(near.get(key)!),
        far: drift(far.get(key)!),
        nearNote: near.get(key)!.note ?? '—',
        farNote: far.get(key)!.note ?? '—',
      })),
    };
  }, [scenario]);

  return (
    <>
      <section className="panel">
        <div className="field">
          <label htmlFor="wide-a">A</label>
          <input
            id="wide-a"
            value={state.aLiteral}
            onChange={(event) => {
              const aLiteral = event.target.value;
              onChange((current) => ({ ...current, aLiteral }));
            }}
          />
          <label htmlFor="wide-b">B</label>
          <input
            id="wide-b"
            value={state.bLiteral}
            onChange={(event) => {
              const bLiteral = event.target.value;
              onChange((current) => ({ ...current, bLiteral }));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="wide-digit">Digit width</label>
          <select
            id="wide-digit"
            value={state.digitBits}
            onChange={(event) => {
              const digitBits = Number(event.target.value) as DigitWidth;
              onChange((current) => ({ ...current, digitBits }));
            }}
          >
            {DIGIT_WIDTHS.map((bits) => (
              <option key={bits} value={bits}>
                {bits}-bit digits
              </option>
            ))}
          </select>
          <label htmlFor="wide-scenario">Scenario</label>
          <select
            id="wide-scenario"
            value={state.scenario}
            onChange={(event) => {
              const next = event.target.value as ArchitectureState['scenario'];
              onChange((current) => ({ ...current, scenario: next }));
            }}
          >
            {SCENARIO_NAMES.map((name) => (
              <option key={name} value={name}>
                {SCENARIOS[name].label}
              </option>
            ))}
          </select>
          <label htmlFor="wide-skip">Skip zero digits</label>
          <input
            id="wide-skip"
            type="checkbox"
            checked={state.skipZeroDigits}
            onChange={(event) => {
              const skipZeroDigits = event.target.checked;
              onChange((current) => ({ ...current, skipZeroDigits }));
            }}
          />
        </div>
        <p className="lens-question">
          Powers and sums, so a sparse 1024-bit value is something you can type:{' '}
          <code>2^700 + 2^12</code>. {scenario.intent}
        </p>
        {parsed.error !== undefined && <p className="error">{parsed.error}</p>}
      </section>

      {computed !== undefined && (
        <>
          <section className="panel">
            <h3>What the registers are carrying</h3>
            <ChunkRow label="A" report={computed.profileA} />
            <ChunkRow label="B" report={computed.profileB} />
            <p className="lens-question">
              Each block is one radix-2<sup>{state.digitBits}</sup> digit, highest on the left. A
              declared width is not a used width: a nominally 1024-bit machine often processes far
              less, and the path it dispatches to comes from what is there rather than from what was
              declared.
            </p>
          </section>

          <section className="panel">
            <h3>Partial products</h3>
            <MultiplyMatrix
              a={computed.profileA}
              b={computed.profileB}
              skipZeroDigits={state.skipZeroDigits}
            />
            <table className="readout">
              <tbody>
                <tr>
                  <th scope="row">Possible</th>
                  <td className="mono">{computed.product.metrics.partialProductsPossible}</td>
                </tr>
                <tr>
                  <th scope="row">Executed</th>
                  <td className="mono">{computed.product.metrics.partialProductsExecuted}</td>
                </tr>
                <tr>
                  <th scope="row">Skipped</th>
                  <td className="mono">{computed.product.metrics.partialProductsSkipped}</td>
                </tr>
                <tr>
                  <th scope="row">Modeled cycles</th>
                  <td className="mono">{computed.product.metrics.modeledCycles}</td>
                </tr>
                <tr>
                  <th scope="row">Widest intermediate</th>
                  <td className="mono">{computed.product.metrics.wideTemporaryBits} bits</td>
                </tr>
              </tbody>
            </table>
            <p className="lens-question">
              Faded cells are partial products the zero digits let the machine skip. Turning the
              optimization off does not change the answer, only the work — and skipping is not free:
              inspecting a digit costs something too, and at a high enough control cost the saving
              reverses.
            </p>
          </section>

          <section className="panel">
            <h3>Wide first, narrow later</h3>
            <NarrowBands fullBits={FRACTION_BITS * 2} destinationBits={FRACTION_BITS} />
            <table className="readout">
              <tbody>
                <tr>
                  <th scope="row">Operands read as</th>
                  <td className="mono">
                    Q{REGISTER_BITS - FRACTION_BITS}.{FRACTION_BITS}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Full product</th>
                  <td className="mono">
                    {describeWideLiteral(computed.product.value)}
                    <br />
                    <small>
                      {FRACTION_BITS * 2} fraction bits, in{' '}
                      {computed.product.metrics.destinationWidth} of width
                    </small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Narrowed back</th>
                  <td className="mono">
                    {computed.narrowed === undefined ? (
                      <small>refused: {computed.refusal}</small>
                    ) : (
                      <>
                        {describeWideLiteral(computed.narrowed.value)}
                        <br />
                        <small>{FRACTION_BITS} fraction bits</small>
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Residue</th>
                  <td className="mono">
                    {computed.narrowed === undefined ? (
                      <small>no narrowing happened, so there is nothing left over</small>
                    ) : computed.narrowed.exact ? (
                      <span className="tag tag-exact">nothing lost</span>
                    ) : (
                      describeWideLiteral(computed.narrowed.residue)
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Policy</th>
                  <td className="mono">
                    {scenario.narrowing.rounding}, residue {scenario.narrowing.residue}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="lens-question">
              The multiply keeps every bit; deciding what to lose is a separate operation with a
              name and a policy. The residue is the part that did not fit, handed back rather than
              dropped — a caller can round with it, keep it, or accumulate it, but it is never taken
              away silently.
            </p>
          </section>
        </>
      )}

      {division !== undefined && (
        <section className="panel">
          <h3>One quotient digit at a time</h3>
          {division.error !== undefined && <p className="error">{division.error}</p>}
          {division.result !== undefined &&
            (() => {
              const steps = division.result.steps ?? [];
              // A shared link can carry a position from a different pair of
              // operands, so the stored step is a request rather than a fact.
              const position = Math.min(state.divisionStep, steps.length);
              const current = position === 0 ? undefined : steps[position - 1];
              const divisorMagnitude =
                parsed.b === undefined ? 0n : parsed.b < 0n ? -parsed.b : parsed.b;
              const consumed = current?.consumed ?? 0n;
              const quotient = current?.quotientSoFar ?? 0n;
              const remainder = current?.remainder ?? 0n;
              const holds = consumed === quotient * divisorMagnitude + remainder;

              return (
                <>
                  <div className="field">
                    <label htmlFor="wide-division-step">Quotient digit</label>
                    <input
                      id="wide-division-step"
                      type="range"
                      min={0}
                      max={steps.length}
                      value={position}
                      onChange={(event) => {
                        const divisionStep = Number(event.target.value);
                        onChange((currentState) => ({ ...currentState, divisionStep }));
                      }}
                    />
                  </div>
                  <QuotientTape steps={steps} position={position} divisor={divisorMagnitude} />
                  <table className="readout">
                    <tbody>
                      <tr>
                        <th scope="row">Read so far</th>
                        <td className="mono">{describeWideLiteral(consumed)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Quotient × divisor</th>
                        <td className="mono">
                          {describeWideLiteral(quotient)} × {describeWideLiteral(divisorMagnitude)}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Remainder</th>
                        <td className="mono">{describeWideLiteral(remainder)}</td>
                      </tr>
                      <tr>
                        <th scope="row">A = Q × B + R</th>
                        <td className="mono">
                          {holds ? (
                            <span className="tag tag-exact">holds</span>
                          ) : (
                            <span className="error">does not hold at this step</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Modeled cycles</th>
                        <td className="mono">{division.result.metrics.modeledCycles}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="lens-question">
                    Shift a bit down, compare, subtract if it fits. The identity is not something
                    the division arrives at when it finishes — it is true after every single digit,
                    with the remainder holding exactly what has not been accounted for yet. Step
                    zero is the machine before it starts, where <code>0 = 0 × B + 0</code>. The
                    numerator is scaled by 2<sup>{DIVISION_FRACTION_BITS}</sup> first (§11), so the
                    last {DIVISION_FRACTION_BITS} digits are the fraction.
                  </p>
                </>
              );
            })()}
        </section>
      )}

      <section className="panel">
        <h3>The same arithmetic, four ways</h3>
        <ErrorScale rows={comparison.rows} />
        <table className="readout comparison">
          <thead>
            <tr>
              <th scope="col">Representation</th>
              <th scope="col">Drift near zero</th>
              <th scope="col">Drift at 10^6 m</th>
            </tr>
          </thead>
          <tbody>
            {comparison.table.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="mono">
                  {row.near === undefined ? (
                    <small>{row.nearNote}</small>
                  ) : (
                    <Rendered value={row.near} />
                  )}
                </td>
                <td className="mono">
                  {row.far === undefined ? (
                    <small>{row.farNote}</small>
                  ) : (
                    <Rendered value={row.far} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="lens-question">
          Add a tenth a thousand times, then do it again starting a million metres out. The
          fixed-point machines land in exactly the same place both times, because their quantum is
          absolute and does not know where it is; binary64 coarsens by 4096, which is 2<sup>12</sup>{' '}
          — twelve binades, not six decades. None of them is exact, because a tenth is not a binary
          fraction, and width does not change that. The scenario above governs the wide machine
          only: binary64 and Q128.128 have fixed contracts, so trapping on inexact stops one row and
          leaves the others running.
        </p>
      </section>
    </>
  );
}
