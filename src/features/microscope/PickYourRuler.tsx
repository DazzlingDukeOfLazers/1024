/**
 * "Same 256 bits. Pick your ruler."
 *
 * docs/UI_SPEC.md wants this in the Microscope (§4, machine base unit, physical
 * LSB and physical range) and in a compact form in the Lab (§5). One component,
 * used by both, so the two can never disagree about what a machine can hold.
 */

import { type Rational, isZero } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatCount, formatScientific } from '../../core/units/format';
import { metersToPlanckLengths } from '../../core/representations/planck';
import { type Q128_128PresetName } from '../../core/representations/q128_128';
import { baseUnitSummaries } from './lattice';

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

export interface PickYourRulerProps {
  /** The magnitude each machine is asked to hold. */
  meters: Rational;
  /** Highlighted machine, if the caller tracks one. */
  preset?: Q128_128PresetName | undefined;
  onPresetChange?: ((preset: Q128_128PresetName) => void) | undefined;
}

export function PickYourRuler({ meters: reference, preset, onPresetChange }: PickYourRulerProps) {
  const summaries = baseUnitSummaries(reference);

  return (
    <table className="readout">
      <thead>
        <tr>
          <th scope="col">Machine</th>
          <th scope="col">LSB</th>
          <th scope="col">Max reach</th>
          <th scope="col">This value</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((summary) => (
          <tr key={summary.preset} className={summary.preset === preset ? 'selected' : undefined}>
            <th scope="row">
              {onPresetChange === undefined ? (
                `Q128.128 @ ${summary.label}`
              ) : (
                <button
                  type="button"
                  className="row-toggle"
                  aria-pressed={summary.preset === preset}
                  onClick={() => onPresetChange(summary.preset)}
                >
                  Q128.128 @ {summary.label}
                </button>
              )}
            </th>
            <td className="mono">
              {meters(summary.lsbMeters)}
              <br />
              <small>{formatCount(metersToPlanckLengths(summary.lsbMeters)).text} lP</small>
            </td>
            <td className="mono">{meters(summary.maxMeters)}</td>
            <td className="mono">
              {summary.outOfRange ? (
                <span className="error">out of range</span>
              ) : (
                <>
                  <span className={summary.exact ? 'tag tag-exact' : 'tag tag-rounded'}>
                    {summary.exact ? 'exact' : 'quantized'}
                  </span>
                  {!summary.exact &&
                    summary.quantizationError !== undefined &&
                    !isZero(summary.quantizationError) && (
                      <>
                        <br />
                        <small>error {meters(summary.quantizationError)}</small>
                      </>
                    )}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
