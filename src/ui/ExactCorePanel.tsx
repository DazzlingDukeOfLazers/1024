/**
 * Milestone 1 debug panel.
 *
 * Deliberately ugly. Its only job is to prove the exact quantity core is
 * trustworthy in a browser: hold the value as an exact rational and render it
 * several ways without ever changing what it is.
 */

import { toCompactString } from '../core/rational/json';
import { toExactDecimalString } from '../core/rational/decimal';
import { log10RationalForDisplay, orderOfMagnitude10 } from '../core/rational/log10';
import { isZero } from '../core/rational/rational';
import { type Quantity, toUnit } from '../core/quantities/quantity';
import { formatEngineering, formatRawSi, formatScientific } from '../core/units/format';
import { findUnit } from '../core/units/units';
import { ExactnessTag } from './ExactnessTag';

const DISPLAY_UNITS = [
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

export interface ExactCorePanelProps {
  quantity: Quantity;
  displayUnit: string;
  onDisplayUnitChange: (unit: string) => void;
}

export function ExactCorePanel({
  quantity,
  displayUnit,
  onDisplayUnitChange,
}: ExactCorePanelProps) {
  const sameDimension = findUnit(displayUnit)?.dimension === quantity.dimension;

  return (
    <section className="panel">
      <h3>Exact quantity core</h3>

      <div className="field">
        <label htmlFor="display-unit">Read as</label>
        <select
          id="display-unit"
          value={displayUnit}
          onChange={(event) => onDisplayUnitChange(event.target.value)}
        >
          {DISPLAY_UNITS.map((symbol) => (
            <option key={symbol} value={symbol}>
              {symbol}
            </option>
          ))}
        </select>
      </div>

      <table className="readout">
        <tbody>
          {readoutRows(quantity).map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {/* This panel shows both verdicts, because comparing them across
                  renderings of one value is its whole point: engineering exact,
                  scientific rounded, same number. `data-exact` is what the
                  conformance sweep reads. */}
              <td className="mono">
                <span data-exact={row.exact === false ? 'false' : 'true'}>
                  {row.value} {row.exact !== undefined && <ExactnessTag exact={row.exact} />}
                </span>
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">In {displayUnit}</th>
            <td className="mono">
              {sameDimension
                ? `${toCompactString(toUnit(quantity, displayUnit))} ${displayUnit}`
                : `not a ${quantity.dimension} unit`}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="lens-question">
        Changing the display unit re-reads the same exact value. It never rewrites it.
      </p>
    </section>
  );
}
