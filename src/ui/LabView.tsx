/**
 * Representation Lab, milestone 0–2 form.
 *
 * One exact value, entered once, shown through the exact core and then through
 * each finite machine. Not the timeline UI from docs/UI_SPEC.md — that arrives
 * with the experiment runner in milestone 4/9.
 */

import { useMemo, useState } from 'react';
import { parseDecimalExact } from '../core/rational/parse';
import { type Quantity, fromUnit } from '../core/quantities/quantity';
import { ExactCorePanel } from './ExactCorePanel';
import { FiniteMachinesPanel } from './FiniteMachinesPanel';

const UNIT_CHOICES = [
  'pm',
  'nm',
  'µm',
  'mm',
  'm',
  'km',
  'Mm',
  'Gm',
  'ms',
  's',
  'min',
  'h',
  'd',
  'a',
];

function isLength(value: Quantity): value is Quantity<'length'> {
  return value.dimension === 'length';
}

export function LabView() {
  const [literal, setLiteral] = useState('0.1');
  const [unit, setUnit] = useState('m');

  const parsed = useMemo(() => {
    try {
      return { quantity: fromUnit(parseDecimalExact(literal), unit), error: undefined };
    } catch (error) {
      return { quantity: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [literal, unit]);

  return (
    <>
      <section className="panel">
        <div className="field">
          <label htmlFor="literal">Value</label>
          <input
            id="literal"
            value={literal}
            onChange={(event) => setLiteral(event.target.value)}
            size={20}
          />
          <label htmlFor="unit">Unit</label>
          <select id="unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
            {UNIT_CHOICES.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </div>
        {parsed.error !== undefined && <p className="error">{parsed.error}</p>}
      </section>

      {parsed.quantity !== undefined && <ExactCorePanel quantity={parsed.quantity} />}
      {parsed.quantity !== undefined && isLength(parsed.quantity) && (
        <FiniteMachinesPanel length={parsed.quantity} />
      )}
    </>
  );
}
