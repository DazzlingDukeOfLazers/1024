/**
 * Two strategies for the same rotation, raced against each other.
 *
 * `RotationPanel` asks where a machine may be finite. This asks a different
 * question — what you choose to *store* — and the two answers are not the same
 * kind of thing. Compose the rotation and the error accumulates; keep the angle
 * and it does not.
 */

import { type Rational, ZERO, compare } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatScientific } from '../../core/units/format';
import {
  ANGLE_PERIOD,
  REFERENCE_DIGITS,
  type TrackRun,
  crossoverStep,
  runAngle,
  runComposed,
} from '../../core/experiments/angleTrack';
import { encodeRational, exactValue } from '../../core/representations/binary64';
import { Q128_128_PRESETS, encodeMeters as encodeQ128 } from '../../core/representations/q128_128';

const STEPS = 400;

const asBinary64 = (value: Rational): Rational | undefined => {
  const encoded = encodeRational(value);
  return encoded.state.kind === 'finite' ? exactValue(encoded.state.value) : undefined;
};
const asQ128 = (value: Rational): Rational | undefined =>
  encodeQ128(Q128_128_PRESETS['m']!, value).decoded;

const MACHINES = [
  { id: 'binary64', label: 'binary64', quantize: asBinary64 },
  { id: 'q128', label: 'Q128.128 @ m', quantize: asQ128 },
] as const;

interface Race {
  readonly label: string;
  readonly composed: TrackRun;
  readonly angle: TrackRun;
  readonly crossover: number | undefined;
}

const RACES: readonly Race[] = MACHINES.map((machine) => {
  const composed = runComposed(machine.id, machine.label, machine.quantize, STEPS);
  const angle = runAngle(machine.id, machine.label, machine.quantize, STEPS);
  return { label: machine.label, composed, angle, crossover: crossoverStep(composed, angle) };
});

/** Squared distances, so the display says so rather than implying a distance. */
function error(value: Rational): string {
  if (compare(value, ZERO) === 0) return 'exactly 0';
  return formatScientific(quantity('length', value)).text.replace(' m', '');
}

function TrackRows({ race }: { race: Race }) {
  return (
    <>
      {([race.composed, race.angle] as const).map((run) => (
        <tr key={`${race.label}-${run.strategy}`}>
          <th scope="row">{race.label}</th>
          <td>
            {run.strategy === 'compose' ? 'compose the rotation' : 'keep the angle'}
            <br />
            <small>
              {run.strategy === 'compose'
                ? 'the machine multiplies its own last answer'
                : 'exact angle, one sine and cosine each time'}
            </small>
          </td>
          <td className="mono">
            {run.exactSteps} of {run.samples.length}
            <br />
            <small>{run.exactSteps === 0 ? 'never on the point' : 'exactly on the point'}</small>
          </td>
          <td className="mono">
            {error(run.worstError)}
            <br />
            <small>
              {run.withinFirstTurn ? 'never worse than its first turn' : 'still getting worse'}
            </small>
          </td>
        </tr>
      ))}
    </>
  );
}

export function AngleTrackPanel() {
  const crossovers = [...new Set(RACES.map((race) => race.crossover))];
  const sameCrossover = crossovers.length === 1 && crossovers[0] !== undefined;

  return (
    <section className="panel">
      <h3>Two ways to turn: compose, or keep the angle</h3>

      <p className="lens-question">
        The step is <span className="mono">π/8</span>, held in a register scaled by π — bits above
        the point are half-turns, bits below are fractions of one. That makes the angle{' '}
        <strong>dyadic</strong>, so it lands exactly on a binary register&rsquo;s grid, accumulates
        by integer addition without drift, and wraps at a full turn by dropping a bit rather than
        subtracting an approximation of 2π. Track A never stores the angle at all: it multiplies by
        a rotation matrix and feeds each answer back in. Track B stores the angle and rebuilds the
        vector from it.
      </p>

      <table className="readout">
        <thead>
          <tr>
            <th scope="col">Machine</th>
            <th scope="col">What it stores</th>
            {/* Not "Steps landing exactly right". The conformance sweep reads a
                column header for a claim about the cells beneath it, and these
                cells are counts — "exactly" was doing rhetorical work in a
                header, which is the habit that rule exists to break. The word
                belongs in the cell, where it describes the landing. */}
            <th scope="col">Steps landing on the point</th>
            <th scope="col">Worst squared distance</th>
          </tr>
        </thead>
        <tbody>
          {RACES.map((race) => (
            <TrackRows key={race.label} race={race} />
          ))}
        </tbody>
      </table>

      <p className="lens-question">
        Every {ANGLE_PERIOD / 4} steps is a quarter turn, where the answer is 0 or ±1 and every
        machine here can hold it exactly. Track B lands on those {STEPS / 4} points{' '}
        <strong>exactly</strong>, because it asks the same question at step <em>n</em> and step{' '}
        <em>n</em> + {ANGLE_PERIOD} and gets the same answer. Track A lands on none of them, ever.
      </p>

      {sameCrossover && (
        <p className="lens-question">
          <strong>The crossover is step {crossovers[0]}, on both machines.</strong> Composing pays
          nothing up front and accumulates; the angle pays one rounding immediately and then stops
          paying. So composing is ahead for exactly one step, and behind for every step after it —
          which is the same answer §10 gives about division algorithms: there is no better strategy,
          only a better strategy for how far you are going.
        </p>
      )}

      <p className="lens-question">
        One caveat, and it is the first of its kind here.{' '}
        <strong>The reference is declared, not exact.</strong> Niven&rsquo;s theorem says the only
        rational multiples of π with a rational sine are the ones giving 0, ±½ and ±1, so an angle
        exactly representable in a π-scaled register has an irrational sine everywhere except the
        quarter turns. You may have an exact angle or an exact rotation matrix, not both — and{' '}
        <em>Turning a vector</em> above takes the other side of that trade, with cos θ = 3/5 exactly
        and an angle no register could hold. The sines here come from <code>tools/oracle.py</code>{' '}
        at {REFERENCE_DIGITS} significant digits. An error smaller than that is not small; it is
        unmeasured.
      </p>
    </section>
  );
}
