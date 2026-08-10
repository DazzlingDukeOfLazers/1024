/**
 * Representation Lab, milestone 0–2 form.
 *
 * One exact value, entered once, shown through the exact core and then through
 * each finite machine. Not the timeline UI from docs/UI_SPEC.md — that arrives
 * with the experiment runner in milestone 4/9.
 */

import { useMemo } from 'react';
import { parseDecimalExact } from '../core/rational/parse';
import { type Quantity, fromUnit } from '../core/quantities/quantity';
import { ExactCorePanel } from './ExactCorePanel';
import { FiniteMachinesPanel } from './FiniteMachinesPanel';
import { Binary64Panel } from './Binary64Panel';
import { RepresentationLab } from '../features/representation-lab/RepresentationLab';
import { FloatingOriginPanel } from '../features/representation-lab/FloatingOriginPanel';
import { RotationPanel } from '../features/representation-lab/RotationPanel';
import { type LabState, type RepresentationState } from '../share/appState';

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

export interface LabViewProps {
  state: LabState;
  onChange: (update: (current: LabState) => LabState) => void;
  representations: RepresentationState;
  onRepresentationsChange: (update: (current: RepresentationState) => RepresentationState) => void;
}

export function LabView({
  state,
  onChange,
  representations,
  onRepresentationsChange,
}: LabViewProps) {
  const { literal, unit } = state;
  const setLiteral = (next: string): void => onChange((current) => ({ ...current, literal: next }));
  const setUnit = (next: string): void => onChange((current) => ({ ...current, unit: next }));

  const parsed = useMemo(() => {
    try {
      return { quantity: fromUnit(parseDecimalExact(literal), unit), error: undefined };
    } catch (error) {
      return { quantity: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [literal, unit]);

  return (
    <>
      <RepresentationLab
        experimentId={state.experimentId}
        onExperimentChange={(experimentId) => onChange((current) => ({ ...current, experimentId }))}
        zoomToDisagreement={state.zoomToDisagreement}
        onZoomChange={(zoomToDisagreement) =>
          onChange((current) => ({ ...current, zoomToDisagreement }))
        }
      />

      <FloatingOriginPanel />

      <RotationPanel />

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

      {parsed.quantity !== undefined && (
        <ExactCorePanel
          quantity={parsed.quantity}
          displayUnit={state.displayUnit}
          onDisplayUnitChange={(displayUnit) =>
            onChange((current) => ({ ...current, displayUnit }))
          }
        />
      )}
      {parsed.quantity !== undefined && isLength(parsed.quantity) && (
        <>
          <Binary64Panel length={parsed.quantity} />
          <FiniteMachinesPanel
            length={parsed.quantity}
            preset={representations.q128Preset}
            onPresetChange={(q128Preset) => onRepresentationsChange(() => ({ q128Preset }))}
          />
        </>
      )}
    </>
  );
}
