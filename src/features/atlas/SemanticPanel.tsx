/**
 * Progressive semantic detail.
 *
 * docs/UI_SPEC.md: "This is graph traversal driven by scale, not a hard-coded
 * single tree." So the panel asks the graph two separate questions —
 *
 *   what is related to this?      (ontology navigation)
 *   what else lives at this size? (metric navigation)
 *
 * — and answers both against the band the camera is currently showing. Things
 * out of view are kept and labelled with how far, because "zoom in and there is
 * more" only works if you can see there is more.
 */

import { type Rational } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatEngineering } from '../../core/units/format';
import { CATALOG, requireLength } from '../../catalog/catalog';
import {
  type ScaleBand,
  type Suggestion,
  relationPath,
  revealedIn,
  suggestFrom,
} from '../../catalog/graph';

function size(meters: Rational): string {
  return formatEngineering(quantity('length', meters)).text;
}

function directionOf(suggestion: Suggestion): string {
  switch (suggestion.visibility) {
    case 'in-band':
      return 'in view';
    case 'below-band':
      return `zoom in ${suggestion.decadesAway.toFixed(1)} decades`;
    case 'above-band':
      return `zoom out ${suggestion.decadesAway.toFixed(1)} decades`;
  }
}

function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: Suggestion;
  onSelect: (id: string) => void;
}) {
  return (
    <tr className={suggestion.visibility === 'in-band' ? 'selected' : undefined}>
      <th scope="row">
        <button type="button" className="row-toggle" onClick={() => onSelect(suggestion.object.id)}>
          {suggestion.object.name}
        </button>
      </th>
      <td className="mono">{suggestion.edge?.label ?? '—'}</td>
      <td className="mono">{size(requireLength(suggestion.object).value.value)}</td>
      <td className="mono">
        <small>{directionOf(suggestion)}</small>
      </td>
    </tr>
  );
}

export interface SemanticPanelProps {
  selectedId: string | undefined;
  band: ScaleBand;
  onSelect: (id: string) => void;
}

export function SemanticPanel({ selectedId, band, onSelect }: SemanticPanelProps) {
  const selected = selectedId === undefined ? undefined : CATALOG.get(selectedId);
  const related = selected === undefined ? [] : suggestFrom(CATALOG, selected.id, band);
  // Everything named above, not just the selection: the table below says these
  // are unrelated, and it has to be true.
  const named = [
    ...(selectedId === undefined ? [] : [selectedId]),
    ...related.map((suggestion) => suggestion.object.id),
  ];
  const nearby = revealedIn(CATALOG, band, named).slice(0, 8);

  // A chain worth showing off: the spec's human → hand → finger → cell → DNA,
  // discovered by search rather than written down anywhere.
  const chain =
    selected === undefined ? undefined : relationPath(CATALOG, selected.id, 'dna-helix');

  return (
    <section className="panel">
      <h3>Related at this scale</h3>

      {selected === undefined ? (
        <p className="lens-question">
          Select an object to walk the graph from it. Zooming changes what is within reach.
        </p>
      ) : related.length === 0 ? (
        <p className="lens-question">
          Nothing in the catalog is related to {selected.name} yet. Relations are authored where
          they mean something; an empty list is more honest than an invented one.
        </p>
      ) : (
        <>
          <table className="readout">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Relation</th>
                <th scope="col">Size</th>
                <th scope="col">From here</th>
              </tr>
            </thead>
            <tbody>
              {related.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.object.id}
                  suggestion={suggestion}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>

          {chain !== undefined && chain.length > 2 && (
            <p className="lens-question">
              Ontology navigation:{' '}
              {chain.map((step, index) => (
                <span key={step.object.id}>
                  {index > 0 && ' → '}
                  {step.object.name}
                </span>
              ))}
            </p>
          )}
        </>
      )}

      {nearby.length > 0 && (
        <>
          <h4>Also at this size</h4>
          <table className="readout">
            <tbody>
              {nearby.map((suggestion) => (
                <tr key={suggestion.object.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="row-toggle"
                      onClick={() => onSelect(suggestion.object.id)}
                    >
                      {suggestion.object.name}
                    </button>
                  </th>
                  <td className="mono">{size(requireLength(suggestion.object).value.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lens-question">
            Unrelated to the selection — these simply live at the size you are looking at. Zooming
            is both metric and ontology navigation.
          </p>
        </>
      )}
    </section>
  );
}
