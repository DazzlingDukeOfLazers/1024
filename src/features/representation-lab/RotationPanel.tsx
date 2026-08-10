/**
 * Repeated rotation — PROJECT_SPEC §7.
 *
 * Every other experiment here drifts a *value*. This one drifts a **shape**: a
 * rotation must not change a vector's length, so the length is a conserved
 * quantity the machine is supposed to preserve and cannot.
 *
 * The reason it earns a panel of its own rather than a row in the timeline is
 * the mode column. Rounding only the stored result and rounding every multiply
 * and add are docs/NUMERICS.md §7's two error categories, and on binary64 they
 * send the vector in opposite directions.
 */

import { type Rational, ZERO, compare } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatCount, formatScientific } from '../../core/units/format';
import {
  type RotationMode,
  type RotationRun,
  exactDigitsAfter,
  runRotation,
} from '../../core/experiments/rotation';
import { encodeRational, exactValue } from '../../core/representations/binary64';
import { Q128_128_PRESETS, encodeMeters as encodeQ128 } from '../../core/representations/q128_128';
import {
  DEFAULT_PLANCK_CONFIG,
  encodeMeters as encodePlanck,
} from '../../core/representations/planck';

const STEPS = 200;

function scientific(value: Rational): string {
  return formatScientific(quantity('length', value)).text.replace(' m', '');
}

const asBinary64 = (value: Rational): Rational | undefined => {
  const encoded = encodeRational(value);
  return encoded.state.kind === 'finite' ? exactValue(encoded.state.value) : undefined;
};
const asQ128 = (value: Rational): Rational | undefined =>
  encodeQ128(Q128_128_PRESETS['m']!, value).decoded;
const asPlanck = (value: Rational): Rational | undefined =>
  encodePlanck(value, DEFAULT_PLANCK_CONFIG).decoded;

const MACHINES = [
  { id: 'binary64', label: 'binary64', quantize: asBinary64 },
  { id: 'q128', label: 'Q128.128 @ m', quantize: asQ128 },
  { id: 'planck', label: 'Planck grid', quantize: asPlanck },
] as const;

const MODES: readonly { mode: RotationMode; label: string; note: string }[] = [
  { mode: 'store', label: 'registers only', note: 'exact arithmetic, finite storage' },
  { mode: 'operate', label: 'arithmetic too', note: 'every multiply and add lands in a register' },
];

/** Computed once at module load: the inputs are fixed and the work is small. */
const RUNS: readonly RotationRun[] = MACHINES.flatMap((machine) =>
  MODES.map(({ mode }) => runRotation(machine.id, machine.label, machine.quantize, STEPS, mode)),
);

const EXACT_DIGITS = exactDigitsAfter(STEPS);

function driftWord(run: RotationRun): string {
  if (run.drift === 'balanced') return 'neither';
  return run.drift === 'outward' ? 'grew' : 'shrank';
}

export function RotationPanel() {
  const reversed = MACHINES.filter((machine) => {
    const [store, operate] = RUNS.filter((run) => run.id === machine.id);
    return store !== undefined && operate !== undefined && store.drift !== operate.drift;
  });

  return (
    <section className="panel">
      <h3>Turning a vector {STEPS} times</h3>

      <p className="lens-question">
        A rotation must not change a length, so the length is a conserved quantity a machine is
        supposed to preserve and cannot. The angle is the one with{' '}
        <span className="mono">cos θ = 3/5</span> and <span className="mono">sin θ = 4/5</span> —
        about 53.13° — chosen because 3² + 4² = 5² makes the matrix <em>exactly</em> orthogonal. A
        rotation by 1° could not be the reference here: cos 1° is irrational, so the exact answer
        would itself be an approximation. This one never closes either, so a long run never gets a
        free ride from the orbit returning to where it started.
      </p>

      <table className="readout">
        <thead>
          <tr>
            <th scope="col">Machine</th>
            <th scope="col">Finite where</th>
            <th scope="col">Length</th>
            <th scope="col">Worst |x² + y² − 1|</th>
          </tr>
        </thead>
        <tbody>
          {RUNS.map((run, index) => {
            const mode = MODES[index % MODES.length]!;
            return (
              <tr key={`${run.id}-${run.mode}`}>
                <th scope="row">{run.label}</th>
                <td>
                  {mode.label}
                  <br />
                  <small>{mode.note}</small>
                </td>
                <td className="mono">
                  {driftWord(run)}
                  <br />
                  <small>
                    {run.stepsTooLong} of {run.samples.length} checkpoints too long,{' '}
                    {run.stepsTooShort} too short
                  </small>
                </td>
                <td className="mono">
                  {compare(run.worstNormError, ZERO) === 0 ? (
                    <span className="tag tag-exact">exact</span>
                  ) : (
                    scientific(run.worstNormError)
                  )}
                </td>
              </tr>
            );
          })}
          {/* Named for the machine rather than for the claim. It read "exact
              reference", and the conformance sweep was right to object: a row
              header claiming exactness has to have the verified value in the
              cell beside it, and the cell beside it is prose about registers.
              The exactness is asserted once, in the column that carries the
              verdict. */}
          <tr>
            <th scope="row">unbounded rationals</th>
            <td>
              nowhere
              <br />
              <small>no register to round into</small>
            </td>
            <td className="mono">
              neither
              <br />
              <small>on the circle at every step, for ever</small>
            </td>
            <td className="mono">
              <span className="tag tag-exact">exact</span>
            </td>
          </tr>
        </tbody>
      </table>

      {reversed.length > 0 && (
        <p className="lens-question">
          {/* `drift{' '}{n === 1 ? 's' : ''}` put the space *before* the
              suffix and rendered "binary64 drift s" — written on the same day
              as the fix for "1 whole items", which is a good argument for
              building the whole word rather than gluing one on. */}
          <strong>
            {reversed.map((machine) => machine.label).join(' and ')}{' '}
            {reversed.length === 1 ? 'drifts' : 'drift'} in opposite directions depending on where
            it is allowed to be finite.
          </strong>{' '}
          Rounding only what is stored and rounding every operation are docs/NUMERICS.md §7&rsquo;s
          two error categories, and here they do not merely differ in size — they differ in sign.
          The other machines shrink either way, so this is a fact about {reversed[0]!.label} rather
          than a law about finite arithmetic.
        </p>
      )}

      <p className="lens-question">
        And the exact column is not free. After {STEPS} rotations the exact coordinates have
        denominator 5^{STEPS}, so they need{' '}
        <strong>{formatCount(exactCount(EXACT_DIGITS)).text} digits</strong> — about 0.7 more with
        every turn, for ever. The finite machines have the opposite problem: they always fit and
        they always drift. This project spends most of its time showing what a finite representation
        loses, and rather less showing what exactness charges for the privilege.
      </p>
    </section>
  );
}

/** `formatCount` takes a rational; the digit count is an integer. */
function exactCount(digits: number): Rational {
  return { numerator: BigInt(digits), denominator: 1n };
}
