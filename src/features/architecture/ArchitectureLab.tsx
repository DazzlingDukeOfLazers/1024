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
import { describeWideLiteral, parseWideLiteral } from '../../core/wide/parse';
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
    const narrowed = narrow({
      value: product.value,
      sourceFractionBits: FRACTION_BITS * 2,
      sourceWidthBits: REGISTER_BITS * 2,
      destinationFractionBits: FRACTION_BITS,
      destinationWidthBits: REGISTER_BITS,
      policy: { ...scenario.narrowing, range: 'saturate' },
    });
    return { profileA, profileB, product, narrowed };
  }, [parsed, state.digitBits, state.skipZeroDigits, scenario]);

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
                    {describeWideLiteral(computed.narrowed.value)}
                    <br />
                    <small>{FRACTION_BITS} fraction bits</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Residue</th>
                  <td className="mono">
                    {computed.narrowed.exact ? (
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
    </>
  );
}
