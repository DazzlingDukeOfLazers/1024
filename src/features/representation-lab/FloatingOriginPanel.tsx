/**
 * The floating-origin / rebasing demonstration.
 *
 * PROJECT_SPEC §7: the point is not merely that finite precision fails, but
 * that software chooses how to spend it. Same binary64, same two points,
 * different coordinate strategy.
 */

import { type Rational, isZero } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatScientific } from '../../core/units/format';
import {
  builtInFloatingOriginConfig,
  runFloatingOrigin,
} from '../../core/experiments/floatingOrigin';

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

const RESULT = runFloatingOrigin(builtInFloatingOriginConfig());

export function FloatingOriginPanel() {
  const result = RESULT;

  return (
    <section className="panel">
      <h3>Floating origin rescues the millimetre</h3>
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
              <br />
              <small>the local gap is wider than the separation being measured</small>
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
              <small>
                error {meters(result.rebased.separationError)}
                {isZero(result.rebased.separationError) && ' — exact'}
              </small>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lens-question">
        The same binary64, the same two points. Only the coordinate strategy changed. Finite
        precision failing is half the lesson; the other half is that software decides how to spend
        it.
      </p>
    </section>
  );
}
