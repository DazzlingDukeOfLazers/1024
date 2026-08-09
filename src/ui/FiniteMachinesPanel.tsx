/**
 * Milestone 2 debug panel.
 *
 * Still deliberately ugly. It exists to make the finite machines' behaviour
 * visible and checkable: what each configuration can resolve, how far it
 * reaches, and what it did to the value you typed.
 */

import { type Quantity, quantity } from '../core/quantities/quantity';
import { formatScientific } from '../core/units/format';
import { type Rational } from '../core/rational/rational';
import {
  Q128_128_PRESETS,
  type Q128_128PresetName,
  encodeMeters as encodeQ128,
} from '../core/representations/q128_128';
import { encodeMeters as encodePlanck, summarizeLength } from '../core/representations/planck';
import { PLANCK_LENGTH } from '../core/representations/constants';
import { accumulate, createAccumulator, readAccumulator } from '../core/representations/q512_512';
import { PickYourRuler } from '../features/microscope/PickYourRuler';

function meters(value: Rational): string {
  return formatScientific(quantity('length', value)).text;
}

export interface FiniteMachinesPanelProps {
  length: Quantity<'length'>;
  /**
   * Which Q128.128 machine the error meter is fed from. This selects a
   * *machine*, not a display unit (docs/NUMERICS.md §5), so it belongs to the
   * shareable state.
   */
  preset: Q128_128PresetName;
  onPresetChange: (preset: Q128_128PresetName) => void;
}

export function FiniteMachinesPanel({ length, preset, onPresetChange }: FiniteMachinesPanelProps) {
  const planck = encodePlanck(length.value);
  const planckAxis = summarizeLength();

  // One quantization error pushed through a fresh Q512.512 meter, to show that
  // the meter is itself finite. Milestone 4 wires these into the runner.
  const selectedConfig = Q128_128_PRESETS[preset];
  const q128AtM = encodeQ128(selectedConfig, length.value);
  const meterReading =
    q128AtM.quantizationErrorMeters === undefined
      ? undefined
      : accumulate(createAccumulator(), q128AtM.quantizationErrorMeters);

  return (
    <>
      <section className="panel">
        <h3>Same 256 bits. Pick your ruler.</h3>
        <PickYourRuler meters={length.value} preset={preset} onPresetChange={onPresetChange} />
        <p className="lens-question">
          Every row is the same 256-bit register. Only the machine base unit differs — and the
          machine base unit is not the display unit.
        </p>
      </section>

      <section className="panel">
        <h3>Planck grid (256-bit integer)</h3>
        <table className="readout">
          <tbody>
            <tr>
              <th scope="row">LSB</th>
              <td className="mono">
                {meters(PLANCK_LENGTH.nominal)} — one nominal Planck length
                <br />
                <small>
                  {PLANCK_LENGTH.source} {PLANCK_LENGTH.sourceVersion},{' '}
                  {PLANCK_LENGTH.declaredDigits} declared digits
                </small>
              </td>
            </tr>
            <tr>
              <th scope="row">Max reach</th>
              <td className="mono">{meters(planckAxis.max)}</td>
            </tr>
            <tr>
              <th scope="row">This value</th>
              <td className="mono">
                {planck.status === 'rejected' ? (
                  <span className="error">out of range</span>
                ) : (
                  <>
                    {planck.state?.ticks.toString()} ticks
                    <br />
                    {planck.quantizationError !== undefined && (
                      <small>quantization {meters(planck.quantizationError)}</small>
                    )}
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="lens-question">
          A representation thought experiment, not a claim that spacetime is discrete. The grid is
          only as meaningful as the declared constant it is conditioned on, and that
          constant&rsquo;s own measurement uncertainty is a separate quantity — it never enters the
          error ledger.
        </p>
      </section>

      <section className="panel">
        <h3>Q512.512 error meter</h3>
        <div className="field">
          <label htmlFor="q128-preset">Fed from</label>
          <select
            id="q128-preset"
            value={preset}
            onChange={(event) => onPresetChange(event.target.value as Q128_128PresetName)}
          >
            {Object.keys(Q128_128_PRESETS).map((name) => (
              <option key={name} value={name}>
                Q128.128 @ {name}
              </option>
            ))}
          </select>
        </div>
        <table className="readout">
          <tbody>
            <tr>
              <th scope="row">Contribution</th>
              <td className="mono">
                {q128AtM.quantizationErrorMeters === undefined
                  ? 'none — the value did not fit'
                  : meters(q128AtM.quantizationErrorMeters)}
              </td>
            </tr>
            <tr>
              <th scope="row">Meter reads</th>
              <td className="mono">
                {meterReading === undefined ? '—' : meters(readAccumulator(meterReading.state))}
              </td>
            </tr>
            <tr>
              <th scope="row">Meter&rsquo;s own error</th>
              <td className="mono">
                {meterReading === undefined ? '—' : meters(meterReading.meterQuantizationError)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="lens-question">
          The meter is a finite 1024-bit machine, not the exact reference. Contributions below
          2^-512 round away inside it — a finite meter measuring finite error has error of its own.
        </p>
      </section>
    </>
  );
}
