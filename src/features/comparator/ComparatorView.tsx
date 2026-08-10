/**
 * The Comparator lens.
 *
 * docs/UI_SPEC.md §3. Two subjects, an operation, and an answer that never
 * presents a measurement with the confidence of a definition.
 */

import { useMemo } from 'react';
import { type Rational, ONE, isZero } from '../../core/rational/rational';
import { parseRationalExact } from '../../core/rational/parse';
import { fromUnit } from '../../core/quantities/quantity';
import { formatCount, formatEngineering } from '../../core/units/format';
import { CATALOG } from '../../catalog/catalog';
import { provenanceSummary } from '../../catalog/schema';
import { toCompactString } from '../../core/rational/json';
import { Rendered } from '../../ui/Rendered';
import {
  type ComparisonOperation,
  type ComparisonResult,
  type Subject,
  type SubjectChoice,
  areaRatio,
  difference,
  endToEnd,
  howManyFit,
  ratio,
  relativeSpread,
  subjectFromCatalog,
  subjectFromQuantity,
  volumeRatio,
  wholeItemsToSpan,
} from './compare';
import { ComparisonStrip } from './ComparisonStrip';
import { type ComparatorState } from '../../share/appState';

/** Exactly defined lengths the user can compare an object against. */
const UNIT_SUBJECTS = ['nm', 'µm', 'mm', 'm', 'km', 'au', 'ly'];

const OPERATION_LABELS: Record<ComparisonOperation, string> = {
  'how-many-fit': 'how many A fit across B',
  ratio: 'A ÷ B',
  difference: 'A − B',
  'end-to-end': 'N × A, end to end',
  'area-ratio': 'A ÷ B, by area',
  'volume-ratio': 'A ÷ B, by volume',
};

function encodeChoice(choice: SubjectChoice): string {
  return choice.kind === 'object' ? `object:${choice.id}` : `unit:${choice.symbol}`;
}

function decodeChoice(value: string): SubjectChoice {
  const [kind, rest] = value.split(':');
  return kind === 'unit'
    ? { kind: 'unit', symbol: rest ?? 'm' }
    : { kind: 'object', id: rest ?? '' };
}

function subjectOf(choice: SubjectChoice): Subject {
  return choice.kind === 'unit'
    ? subjectFromQuantity(`1 ${choice.symbol}`, fromUnit(ONE, choice.symbol))
    : subjectFromCatalog(CATALOG.require(choice.id));
}

function SubjectPicker({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: SubjectChoice;
  onChange: (choice: SubjectChoice) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={encodeChoice(value)}
        onChange={(event) => onChange(decodeChoice(event.target.value))}
      >
        <optgroup label="Objects">
          {CATALOG.byScale().map((object) => (
            <option key={object.id} value={`object:${object.id}`}>
              {object.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Exactly defined units">
          {UNIT_SUBJECTS.map((symbol) => (
            <option key={symbol} value={`unit:${symbol}`}>
              1 {symbol}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

function Answer({ result }: { result: ComparisonResult }) {
  const spread = result.kind === 'count' ? relativeSpread(result) : undefined;
  const approximate = result.certainty === 'approximate';

  // Six digits of a measured quantity is false precision; four is plenty, and
  // when the spread is wide even that overstates it.
  const digits = spread !== undefined ? 3 : 6;

  const headline =
    result.kind === 'count'
      ? `${approximate ? 'about ' : ''}${formatCount(result.value, digits).text}`
      : `${approximate ? 'about ' : ''}${formatEngineering(result.value, { significantDigits: digits }).text}`;

  const exactValue =
    result.kind === 'count'
      ? formatCount(result.value, 12)
      : formatEngineering(result.value, { significantDigits: 12 });

  return (
    <>
      <p className="answer">
        {headline}
        <span className={approximate ? 'tag tag-rounded' : 'tag tag-exact'}>
          {approximate ? 'approximate' : 'exact'}
        </span>
      </p>

      <table className="readout">
        <tbody>
          <tr>
            <th scope="row">Exact value</th>
            <td className="mono">
              {/* The row is headed "exact", so the decimal under it has to say
                  when it is not. `Rendered` also puts the formatter's verdict in
                  the DOM, which is what stops a future panel quietly dropping
                  it — see e2e/conformance.spec.ts. */}
              <Rendered value={exactValue} />
              {!exactValue.exact && (
                <>
                  <br />
                  <small>
                    exactly{' '}
                    {toCompactString(result.kind === 'count' ? result.value : result.value.value)}{' '}
                    {result.kind === 'count' ? '' : 'm'}
                  </small>
                </>
              )}
            </td>
          </tr>
          {result.range !== undefined && (
            <tr>
              <th scope="row">Range</th>
              <td className="mono">
                {result.kind === 'count'
                  ? `${formatCount(result.range.min, digits).text} to ${formatCount(result.range.max, digits).text}`
                  : `${formatEngineering(result.range.min, { significantDigits: digits }).text} to ${
                      formatEngineering(result.range.max, { significantDigits: digits }).text
                    }`}
              </td>
            </tr>
          )}
          {result.assumes !== undefined && result.assumes.length > 0 && (
            <tr>
              <th scope="row">What this assumes</th>
              <td>
                {/* Deliberately its own row rather than folded into "Why
                    approximate". An assumption is not imprecision: these two
                    lengths can be exactly defined and the answer still only
                    holds if the shapes match. A single caveat line would let
                    "exact" read as "true". */}
                Areas go as the square of a length and volumes as the cube — for the same shape at
                different sizes. This answer assumes {result.assumes.join(' and ')}. The catalog
                knows one length per object and nothing about its shape, so a house is being treated
                as a large coconut.
              </td>
            </tr>
          )}
          <tr>
            <th scope="row">Why approximate</th>
            <td>
              {approximate
                ? `The arithmetic is exact. ${result.approximateBecause.join(' and ')} ${
                    result.approximateBecause.length === 1 ? 'is' : 'are'
                  } not.`
                : 'Both inputs are exactly defined, so the answer is too.'}
            </td>
          </tr>
          {[result.a, result.b]
            .filter((subject, index, all) => all.indexOf(subject) === index)
            .map((subject) => (
              <tr key={subject.label}>
                <th scope="row">{subject.label}</th>
                <td className="mono">
                  {formatEngineering(subject.value).text}
                  {subject.range !== undefined && (
                    <>
                      {' '}
                      <small>
                        ({formatEngineering(subject.range.min).text} to{' '}
                        {formatEngineering(subject.range.max).text})
                      </small>
                    </>
                  )}
                  {/* Every subject, not only the cited ones. Showing the source
                      when there is one and nothing when there is not is how a
                      plausible round number ends up looking like a fact. */}
                  <br />
                  <small>{provenanceSummary(subject)}</small>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </>
  );
}

export interface ComparatorViewProps {
  state: ComparatorState;
  onChange: (update: (current: ComparatorState) => ComparatorState) => void;
}

export function ComparatorView({ state, onChange }: ComparatorViewProps) {
  const { a, b, operation, countText } = state;
  const setA = (next: SubjectChoice): void => onChange((current) => ({ ...current, a: next }));
  const setB = (next: SubjectChoice): void => onChange((current) => ({ ...current, b: next }));
  const setOperation = (next: ComparisonOperation): void =>
    onChange((current) => ({ ...current, operation: next }));
  const setCountText = (next: string): void =>
    onChange((current) => ({ ...current, countText: next }));

  const outcome = useMemo(() => {
    try {
      const subjectA = subjectOf(a);
      const subjectB = subjectOf(b);
      switch (operation) {
        case 'how-many-fit':
          return { result: howManyFit(subjectA, subjectB), error: undefined };
        case 'ratio':
          return { result: ratio(subjectA, subjectB), error: undefined };
        case 'difference':
          return { result: difference(subjectA, subjectB), error: undefined };
        case 'area-ratio':
          return { result: areaRatio(subjectA, subjectB), error: undefined };
        case 'volume-ratio':
          return { result: volumeRatio(subjectA, subjectB), error: undefined };
        case 'end-to-end': {
          const count: Rational = parseRationalExact(countText);
          return { result: endToEnd(subjectA, count), error: undefined };
        }
      }
    } catch (error) {
      return { result: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [a, b, operation, countText]);

  const countResult =
    outcome.result?.kind === 'count' && outcome.result.operation === 'how-many-fit'
      ? outcome.result
      : undefined;
  const layout =
    countResult !== undefined && !isZero(countResult.value)
      ? wholeItemsToSpan(subjectOf(a), subjectOf(b))
      : undefined;

  return (
    <>
      <section className="panel">
        <h3>Compare</h3>

        <SubjectPicker id="subject-a" label="A" value={a} onChange={setA} />

        <div className="field">
          <label htmlFor="operation">Operation</label>
          <select
            id="operation"
            value={operation}
            onChange={(event) => setOperation(event.target.value as ComparisonOperation)}
          >
            {Object.entries(OPERATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {operation === 'end-to-end' && (
            <>
              <label htmlFor="count">N</label>
              <input
                id="count"
                value={countText}
                onChange={(event) => setCountText(event.target.value)}
                size={8}
              />
            </>
          )}
        </div>

        {operation !== 'end-to-end' && (
          <SubjectPicker id="subject-b" label="B" value={b} onChange={setB} />
        )}

        {outcome.error !== undefined && <p className="error">{outcome.error}</p>}
        {outcome.result !== undefined && <Answer result={outcome.result} />}

        {layout !== undefined && (
          <p className="lens-question">
            Laying them out for real takes {layout.count.toLocaleString()} whole items, overshooting
            by {formatEngineering(layout.remainder, { significantDigits: 3 }).text}.
          </p>
        )}
      </section>

      {outcome.result !== undefined && (
        <section className="panel">
          <h3>To scale</h3>
          <ComparisonStrip result={outcome.result} />
        </section>
      )}
    </>
  );
}
