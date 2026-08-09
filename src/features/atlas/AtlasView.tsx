/**
 * The Scale Atlas lens.
 *
 * docs/UI_SPEC.md §1: one logarithmic axis from the Planck length to the
 * observable universe, where equal screen distance is equal change in order of
 * magnitude.
 *
 * Positions come from `log10RationalForDisplay`, so the axis can place values
 * that have no binary64 representation at all — and every screen coordinate
 * stays small, because 62 decades of physical range is 62 units in log space.
 */

import { useEffect, useRef } from 'react';
import { quantity } from '../../core/quantities/quantity';
import { formatEngineering } from '../../core/units/format';
import { type Viewport } from '../../camera/camera';
import {
  type LogCamera,
  decadeTicks,
  log10FromAtlasX,
  panLogByPixels,
  zoomLogAt,
} from '../../camera/logCamera';
import { CATALOG } from '../../catalog/catalog';
import { type AtlasState } from '../../share/appState';
import { SemanticPanel } from './SemanticPanel';
import {
  ATLAS_ENTRIES,
  ATLAS_VIEWPORT,
  clusterLabel,
  clusterNearest,
  clusteredCount,
  declutter,
  fullRangeCamera,
} from './atlas';

const VIEWPORT: Viewport = ATLAS_VIEWPORT;
const AXIS_Y = 186;
const MARKER_Y = 150;
const LABEL_TOP = 34;
const LABEL_ROW_HEIGHT = 17;

const ENTRIES = ATLAS_ENTRIES;
const FULL_RANGE = fullRangeCamera(VIEWPORT);

export interface AtlasViewProps {
  state: AtlasState;
  onChange: (update: (current: AtlasState) => AtlasState) => void;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onOpenInRuler: (id: string) => void;
}

export function AtlasView({
  state,
  onChange,
  selectedId,
  onSelect,
  onOpenInRuler,
}: AtlasViewProps) {
  const camera = state.camera;
  // The camera lives in app state so it can be shared. The updater form means
  // an event handler never has to read the current camera through a ref.
  const setCamera = (next: LogCamera | ((current: LogCamera) => LogCamera)): void => {
    onChange((current) => ({
      camera: typeof next === 'function' ? next(current.camera) : next,
    }));
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{ x: number; moved: boolean } | undefined>(undefined);

  const ticks = decadeTicks(camera, VIEWPORT);
  // The band the camera is showing, which is what makes the suggestions below
  // change as you zoom rather than being a fixed list.
  const band = {
    minLog10: log10FromAtlasX(camera, 0, VIEWPORT),
    maxLog10: log10FromAtlasX(camera, VIEWPORT.widthPx, VIEWPORT),
  };
  const clusters = declutter(ENTRIES, camera, VIEWPORT);
  const selected = selectedId === undefined ? undefined : CATALOG.get(selectedId);
  const selectedEntry = ENTRIES.find((entry) => entry.object.id === selectedId);

  const localX = (element: Element, clientX: number): number => {
    const bounds = element.getBoundingClientRect();
    return ((clientX - bounds.left) / bounds.width) * VIEWPORT.widthPx;
  };

  // Non-passive, for the same reason as the ruler: React's own wheel listener
  // is passive, so `preventDefault` in an onWheel prop does nothing.
  useEffect(() => {
    const element = svgRef.current;
    if (element === null) return undefined;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const x = localX(element, event.clientX);
      const factor = Math.pow(2, -event.deltaY * 0.002);
      // `onChange` directly rather than the `setCamera` wrapper, so the effect
      // depends only on a stable prop and attaches the listener once.
      onChange((current) => ({ camera: zoomLogAt(current.camera, factor, x, VIEWPORT) }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [onChange]);

  return (
    <>
      <section className="panel">
        <div className="field">
          {/* A marker is a pointer-only target, and at low zoom it may be a
              cluster standing in for several objects. The picker makes every
              object reachable by name and by keyboard. */}
          <label htmlFor="atlas-selection">Object</label>
          <select
            id="atlas-selection"
            value={selectedId ?? ''}
            onChange={(event) =>
              onSelect(event.target.value === '' ? undefined : event.target.value)
            }
          >
            <option value="">nothing selected</option>
            {ENTRIES.map((entry) => (
              <option key={entry.object.id} value={entry.object.id}>
                {entry.object.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setCamera(FULL_RANGE)}>
            Whole range
          </button>
          <button
            type="button"
            onClick={() =>
              selectedEntry !== undefined &&
              setCamera({ centerLog10: selectedEntry.log10, pixelsPerDecade: 120 })
            }
            disabled={selectedEntry === undefined}
          >
            Centre on selection
          </button>
          <button
            type="button"
            onClick={() => selectedId !== undefined && onOpenInRuler(selectedId)}
            disabled={selectedId === undefined}
          >
            Open in Ruler
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWPORT.widthPx} ${VIEWPORT.heightPx}`}
          width="100%"
          className="atlas"
          role="img"
          aria-label="Scale atlas"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragState.current = { x: localX(event.currentTarget, event.clientX), moved: false };
          }}
          onPointerMove={(event) => {
            if (dragState.current === undefined) return;
            const x = localX(event.currentTarget, event.clientX);
            const delta = x - dragState.current.x;
            if (Math.abs(delta) > 0.5) {
              dragState.current = { x, moved: true };
              setCamera((current) => panLogByPixels(current, delta));
            }
          }}
          onPointerUp={(event) => {
            const state = dragState.current;
            dragState.current = undefined;
            // A drag pans; a click selects. Distinguishing them here keeps
            // panning from clearing the selection every time.
            if (state === undefined || state.moved) return;
            const hit = clusterNearest(clusters, localX(event.currentTarget, event.clientX));
            onSelect(hit?.representative.object.id);
          }}
          onPointerCancel={() => {
            dragState.current = undefined;
          }}
        >
          {ticks.map((tick) => (
            <g key={tick.exponent}>
              <line
                x1={tick.x}
                y1={LABEL_TOP - 12}
                x2={tick.x}
                y2={AXIS_Y}
                stroke="currentColor"
                strokeOpacity={tick.engineering ? 0.18 : 0.07}
              />
              <line
                x1={tick.x}
                y1={AXIS_Y}
                x2={tick.x}
                y2={AXIS_Y + (tick.engineering ? 10 : 5)}
                stroke="currentColor"
                strokeOpacity={tick.engineering ? 0.8 : 0.4}
              />
              {tick.engineering && (
                <text
                  x={tick.x}
                  y={AXIS_Y + 24}
                  fontSize={11}
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity={0.85}
                >
                  {tick.label}
                </text>
              )}
            </g>
          ))}

          <line
            x1={0}
            y1={AXIS_Y}
            x2={VIEWPORT.widthPx}
            y2={AXIS_Y}
            stroke="currentColor"
            strokeOpacity={0.6}
          />

          {clusters.map((cluster) => {
            const isSelected = cluster.members.some((member) => member.object.id === selectedId);
            const labelY =
              cluster.labelRow < 0 ? undefined : LABEL_TOP + cluster.labelRow * LABEL_ROW_HEIGHT;
            return (
              <g key={cluster.representative.object.id} className={isSelected ? 'selected' : ''}>
                {labelY !== undefined && (
                  <>
                    <line
                      x1={cluster.x}
                      y1={labelY + 3}
                      x2={cluster.x}
                      y2={MARKER_Y - 6}
                      stroke="currentColor"
                      strokeOpacity={isSelected ? 0.7 : 0.2}
                    />
                    <text
                      x={cluster.x + 4}
                      y={labelY}
                      fontSize={11}
                      fill="currentColor"
                      fillOpacity={isSelected ? 1 : 0.8}
                      fontWeight={isSelected ? 600 : 400}
                    >
                      {clusterLabel(cluster)}
                    </text>
                  </>
                )}
                <circle
                  cx={cluster.x}
                  cy={MARKER_Y}
                  r={isSelected ? 6 : Math.min(3 + cluster.members.length, 6)}
                  fill="currentColor"
                  fillOpacity={isSelected ? 1 : 0.55}
                />
              </g>
            );
          })}
        </svg>

        <p className="lens-question">
          Click a marker to select it. Drag to pan, scroll to zoom. {clusteredCount(clusters)} of{' '}
          {ENTRIES.length} objects in view, in {clusters.length} markers — crowded ones merge rather
          than being dropped.
        </p>
      </section>

      <section className="panel">
        <h3>Selection</h3>
        <table className="readout">
          <tbody>
            <tr>
              <th scope="row">Object</th>
              <td className="mono">{selected?.name ?? 'nothing selected'}</td>
            </tr>
            {selectedEntry !== undefined && (
              <>
                <tr>
                  <th scope="row">Size</th>
                  <td className="mono">
                    {formatEngineering(quantity('length', selectedEntry.meters)).text}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Order of magnitude</th>
                  <td className="mono">
                    10^{Math.floor(selectedEntry.log10)} — axis position{' '}
                    {selectedEntry.log10.toFixed(4)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Categories</th>
                  <td className="mono">{selected?.categories.join(', ')}</td>
                </tr>
              </>
            )}
            <tr>
              <th scope="row">Visible span</th>
              <td className="mono">
                10^{log10FromAtlasX(camera, 0, VIEWPORT).toFixed(1)} to 10^
                {log10FromAtlasX(camera, VIEWPORT.widthPx, VIEWPORT).toFixed(1)} m
                <br />
                <small>{camera.pixelsPerDecade.toFixed(1)} px per decade</small>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="lens-question">
          The selection follows you into the other lenses. Nothing here is placed by converting a
          magnitude to a double — the axis positions 10^-35 and 10^27 the same way, and would
          position 10^400 just as happily.
        </p>
      </section>

      <SemanticPanel selectedId={selectedId} band={band} onSelect={onSelect} />
    </>
  );
}
