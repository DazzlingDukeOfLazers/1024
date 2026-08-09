/**
 * Milestone 3 debug panel.
 *
 * The acceptance criterion in docs/IMPLEMENTATION_PLAN.md is that a user can
 * enter 0.1 and inspect the exact value binary64 actually stored. Everything
 * here is read from the bits.
 */

import { type Quantity, quantity } from '../core/quantities/quantity';
import { formatCount, formatScientific } from '../core/units/format';
import { type Rational, ZERO, isZero } from '../core/rational/rational';
import { toExactDecimalString } from '../core/rational/decimal';
import {
  type Binary64State,
  encodeRational,
  errorInLocalGaps,
  fields,
  isFiniteState,
  neighbors,
  relativeError,
} from '../core/representations/binary64';
import { metersToPlanckLengths } from '../core/representations/planck';
import { Rendered } from './Rendered';

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

function inPlanckLengths(value: Rational): string {
  return isZero(value) ? '0' : `${formatCount(metersToPlanckLengths(value)).text} lP`;
}

function categoryLabel(state: Binary64State): string {
  switch (state.kind) {
    case 'finite':
      return state.signBit === 1 && state.value === 0 ? 'finite (negative zero)' : 'finite';
    case 'positive-infinity':
      return '+Infinity';
    case 'negative-infinity':
      return '-Infinity';
    case 'nan':
      return 'NaN';
  }
}

export function Binary64Panel({ length }: { length: Quantity<'length'> }) {
  const encoded = encodeRational(length.value);
  const state = encoded.state;

  if (!isFiniteState(state)) {
    return (
      <section className="panel">
        <h3>binary64</h3>
        <p className="error">
          This value is not finite in binary64 — it encodes as {categoryLabel(state)}. There is no
          stored rational to inspect, so no gap or error figure is offered rather than a fake one.
        </p>
      </section>
    );
  }

  const bits = fields(state.value);
  const neighbourhood = neighbors(state.value);
  const { gapBelow, gapAbove, below, above } = neighbourhood;
  const error = encoded.quantizationError ?? ZERO;
  const relative = relativeError(state.exact, length.value);
  const gapReport = errorInLocalGaps(state.value, length.value);
  const exactDecimal = toExactDecimalString(state.exact);

  return (
    <section className="panel">
      <h3>binary64</h3>
      <table className="readout">
        <tbody>
          <tr>
            <th scope="row">Category</th>
            <td className="mono">
              {categoryLabel(state)}
              {bits.isSubnormal && ' — subnormal'}
            </td>
          </tr>
          <tr>
            <th scope="row">Bits</th>
            <td className="mono">
              {bits.bitsHex}
              <br />
              <small>{bits.bitsBinary}</small>
            </td>
          </tr>
          <tr>
            <th scope="row">Fields</th>
            <td className="mono">
              sign {bits.signBit}, exponent field {bits.exponentField}
              {bits.unbiasedExponent !== undefined && ` (2^${bits.unbiasedExponent})`}
              <br />
              <small>significand {bits.significand.toString()}</small>
            </td>
          </tr>
          <tr>
            <th scope="row">Stored value (exact)</th>
            {/* Every binary64 value has a terminating decimal expansion, so this
                is genuinely exact and prints in full — 55 digits for 0.1. The
                verdict is still carried, because the row header claims it and
                the conformance sweep holds every such row to the same rule. */}
            <td className="mono">
              <Rendered
                value={{
                  text: exactDecimal ?? 'not a terminating decimal',
                  exact: exactDecimal !== undefined,
                }}
              />
            </td>
          </tr>
          <tr>
            <th scope="row">Error vs intent</th>
            <td className="mono">
              {isZero(error) ? (
                <span className="tag tag-exact">exact</span>
              ) : (
                <>
                  {meters(error)}
                  <br />
                  <small>{inPlanckLengths(error)}</small>
                  <br />
                  <small>
                    relative{' '}
                    {relative === undefined
                      ? 'undefined at zero reference'
                      : formatCount(relative).text}
                  </small>
                </>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Gap below</th>
            <td className="mono">
              {gapBelow === undefined ? 'undefined at this boundary' : meters(gapBelow)}
            </td>
          </tr>
          <tr>
            <th scope="row">Gap above</th>
            <td className="mono">
              {gapAbove === undefined ? 'undefined at this boundary' : meters(gapAbove)}
            </td>
          </tr>
          <tr>
            <th scope="row">Error in local gaps</th>
            <td className="mono">
              {gapReport === undefined
                ? '—'
                : `${formatCount(gapReport.fractionOfGap).text} of the gap ${gapReport.gap}`}
            </td>
          </tr>
          <tr>
            <th scope="row">Neighbours</th>
            <td className="mono">
              <small>
                below {isFiniteState(below) ? meters(below.exact) : categoryLabel(below)}
              </small>
              <br />
              <small>
                above {isFiniteState(above) ? meters(above.exact) : categoryLabel(above)}
              </small>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lens-question">
        Two gaps, not one ULP. They differ at every power of two, so a single symmetric spacing
        would be a lie exactly where it matters most.
      </p>
    </section>
  );
}
