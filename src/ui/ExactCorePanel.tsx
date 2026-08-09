/**
 * Milestone 1 debug panel.
 *
 * Deliberately ugly. Its only job is to prove the exact quantity core is
 * trustworthy in a browser: parse a literal exactly, hold it as a rational,
 * and render it several ways without ever changing what it is.
 */

import { useMemo, useState } from 'react';
import { parseDecimalExact } from '../core/rational/parse';
import { toCompactString } from '../core/rational/json';
import { toExactDecimalString } from '../core/rational/decimal';
import { log10RationalForDisplay, orderOfMagnitude10 } from '../core/rational/log10';
import { isZero } from '../core/rational/rational';
import { fromUnit, toUnit, type Quantity } from '../core/quantities/quantity';
import { formatEngineering, formatRawSi, formatScientific } from '../core/units/format';
import { findUnit } from '../core/units/units';

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

interface Row {
  label: string;
  value: string;
  exact?: boolean;
}

function ExactnessTag({ exact }: { exact: boolean }) {
  return (
    <span className={exact ? 'tag tag-exact' : 'tag tag-rounded'}>
      {exact ? 'exact' : 'rounded'}
    </span>
  );
}

function readoutRows(q: Quantity): Row[] {
  const engineering = formatEngineering(q);
  const scientific = formatScientific(q);
  const raw = formatRawSi(q);
  const exactDecimal = toExactDecimalString(q.value);

  const rows: Row[] = [
    { label: 'Engineering', value: engineering.text, exact: engineering.exact },
    { label: 'Scientific', value: scientific.text, exact: scientific.exact },
    { label: 'Raw SI', value: raw.text, exact: raw.exact },
    { label: 'Exact rational', value: toCompactString(q.value), exact: true },
    {
      label: 'Exact decimal',
      value: exactDecimal ?? 'repeating — no finite decimal expansion',
      exact: exactDecimal !== undefined,
    },
  ];

  if (!isZero(q.value)) {
    rows.push({ label: 'Order of magnitude', value: `10^${orderOfMagnitude10(q.value)}` });
    if (q.value.numerator > 0n) {
      rows.push({
        label: 'log10 (atlas position)',
        value: log10RationalForDisplay(q.value).toFixed(6),
      });
    }
  }
  return rows;
}

export function ExactCorePanel() {
  const [literal, setLiteral] = useState('0.1');
  const [unit, setUnit] = useState('m');
  const [displayUnit, setDisplayUnit] = useState('mm');

  const parsed = useMemo(() => {
    try {
      return { quantity: fromUnit(parseDecimalExact(literal), unit), error: undefined };
    } catch (error) {
      return { quantity: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [literal, unit]);

  const sameDimension =
    parsed.quantity !== undefined && findUnit(displayUnit)?.dimension === parsed.quantity.dimension;

  return (
    <section className="panel">
      <h3>Exact quantity core</h3>

      <div className="field">
        <label htmlFor="literal">Value</label>
        <input
          id="literal"
          value={literal}
          onChange={(event) => setLiteral(event.target.value)}
          size={16}
        />
        <label htmlFor="unit">Unit</label>
        <select id="unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
          {UNIT_CHOICES.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
        <label htmlFor="display-unit">Read as</label>
        <select
          id="display-unit"
          value={displayUnit}
          onChange={(event) => setDisplayUnit(event.target.value)}
        >
          {UNIT_CHOICES.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </div>

      {parsed.error !== undefined && <p className="error">{parsed.error}</p>}

      {parsed.quantity !== undefined && (
        <table className="readout">
          <tbody>
            {readoutRows(parsed.quantity).map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="mono">
                  {row.value} {row.exact !== undefined && <ExactnessTag exact={row.exact} />}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">In {displayUnit}</th>
              <td className="mono">
                {sameDimension
                  ? `${toCompactString(toUnit(parsed.quantity, displayUnit))} ${displayUnit}`
                  : `not a ${parsed.quantity.dimension} unit`}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="lens-question">
        Changing the display unit re-reads the same exact value. It never rewrites it.
      </p>
    </section>
  );
}
