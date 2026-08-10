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
import { allLengths, primaryLength, provenanceSummary } from '../../catalog/schema';
import { type AtlasState } from '../../share/appState';
import { KEYBOARD_HINT, commandForKey } from '../../camera/keyboard';
import { type Pinch, pinchOf, pinchScale } from '../../camera/pinch';
import { estimateTextWidth, keepNonOverlapping } from '../../camera/labels';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';
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

const NOMINAL: Viewport = ATLAS_VIEWPORT;
const AXIS_Y = 186;
const MARKER_Y = 150;
const LABEL_TOP = 34;
const LABEL_ROW_HEIGHT = 17;
/** Must match the `fontSize` the decade labels are drawn at, or the width estimate is of the wrong text. */
const TICK_FONT_SIZE = 11;

const ENTRIES = ATLAS_ENTRIES;

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
  // One viewBox unit is one CSS pixel, so the 10 px minimum marker spacing is a
  // real minimum rather than a nominal one.
  const [measuredWidth, measure] = useMeasuredWidth(NOMINAL.widthPx);
  const VIEWPORT = { widthPx: measuredWidth, heightPx: NOMINAL.heightPx };
  const FULL_RANGE = fullRangeCamera(VIEWPORT);

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
  /** Every pointer currently down, by id, at its position in view pixels. */
  const pointers = useRef(new Map<number, number>());
  const pinchState = useRef<Pinch | undefined>(undefined);

  const endPointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    pinchState.current = undefined;
    // Lifting one of two fingers hands the drag to the one still down, so the
    // view continues from where it is rather than jumping.
    const remaining = [...pointers.current.values()];
    dragState.current = remaining.length === 1 ? { x: remaining[0]!, moved: true } : undefined;
  };

  const ticks = decadeTicks(camera, VIEWPORT);
  // Zoomed far out the decade labels ran into each other — "10^-45 m10^-42 m".
  // The ticks all stay; only the labels that would collide are dropped.
  const labelledTicks = new Set(
    keepNonOverlapping(
      ticks.filter((tick) => tick.engineering),
      (tick) => ({
        x: tick.x,
        width: estimateTextWidth(tick.label, TICK_FONT_SIZE),
        anchor: 'middle' as const,
      }),
      // A label centred on the last tick falls half outside the view, where it
      // is cut down the middle rather than read.
      { bounds: { min: 0, max: VIEWPORT.widthPx } },
    ).map((tick) => tick.exponent),
  );
  // The band the camera is showing, which is what makes the suggestions below
  // change as you zoom rather than being a fixed list.
  const band = {
    minLog10: log10FromAtlasX(camera, 0, VIEWPORT),
    maxLog10: log10FromAtlasX(camera, VIEWPORT.widthPx, VIEWPORT),
  };
  const clusters = declutter(ENTRIES, camera, VIEWPORT);
  const selected = selectedId === undefined ? undefined : CATALOG.get(selectedId);
  const selectedLength = selected === undefined ? undefined : primaryLength(selected);
  const otherLengths =
    selected === undefined ? [] : allLengths(selected).filter((one) => one !== selectedLength);
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
      // Measured here rather than closed over, so a resize cannot leave the
      // listener zooming against a width the view no longer has. One viewBox
      // unit is one CSS pixel, so the offset needs no scaling.
      const bounds = element.getBoundingClientRect();
      const viewport = { widthPx: bounds.width, heightPx: NOMINAL.heightPx };
      const x = event.clientX - bounds.left;
      const factor = Math.pow(2, -event.deltaY * 0.002);
      // `onChange` directly rather than the `setCamera` wrapper, so the effect
      // depends only on a stable prop and attaches the listener once.
      onChange((current) => ({ camera: zoomLogAt(current.camera, factor, x, viewport) }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [onChange]);

  /** Arrow keys and friends, so the view is not pointer-only. */
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    const command = commandForKey(event.key, { shiftKey: event.shiftKey });
    if (command === undefined) return;
    event.preventDefault();

    if (command.kind === 'reset') {
      setCamera(FULL_RANGE);
      return;
    }
    if (command.kind === 'pan') {
      setCamera((current) => panLogByPixels(current, command.pixels));
      return;
    }
    setCamera((current) =>
      zoomLogAt(current, Math.pow(2, command.steps * 0.5), VIEWPORT.widthPx / 2, VIEWPORT),
    );
  };

  return (
    <>
      <section className="panel" ref={measure}>
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
          role="application"
          tabIndex={0}
          aria-label={`Scale atlas. ${KEYBOARD_HINT}`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            // Capture is a convenience, not a requirement: a pointer the browser
            // does not know about cannot be captured, and that must not take the
            // gesture down with it.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* not capturable; the gesture works without it */
            }
            const x = localX(event.currentTarget, event.clientX);
            pointers.current.set(event.pointerId, x);
            const pinch = pinchOf([...pointers.current.values()]);
            pinchState.current = pinch;
            // A second finger ends the drag and starts a pinch. `moved` stays
            // true so lifting out of a pinch never reads as a tap.
            dragState.current = pinch === undefined ? { x, moved: false } : { x, moved: true };
          }}
          onPointerMove={(event) => {
            if (!pointers.current.has(event.pointerId)) return;
            const x = localX(event.currentTarget, event.clientX);
            pointers.current.set(event.pointerId, x);

            const pinch = pinchOf([...pointers.current.values()]);
            if (pinch !== undefined) {
              const previous = pinchState.current;
              pinchState.current = pinch;
              if (previous === undefined) return;
              // The midpoint moving is a pan, the fingers separating is a zoom,
              // and a real gesture is nearly always both at once.
              const panPixels = pinch.center - previous.center;
              const factor = pinchScale(previous, pinch);
              setCamera((current) =>
                zoomLogAt(panLogByPixels(current, panPixels), factor, pinch.center, VIEWPORT),
              );
              return;
            }

            if (dragState.current === undefined) return;
            const delta = x - dragState.current.x;
            if (Math.abs(delta) > 0.5) {
              dragState.current = { x, moved: true };
              setCamera((current) => panLogByPixels(current, delta));
            }
          }}
          onPointerUp={(event) => {
            const state = dragState.current;
            const wasPinching = pointers.current.size > 1;
            endPointer(event);
            // A drag pans; a click selects. Distinguishing them here keeps
            // panning from clearing the selection every time.
            if (state === undefined || state.moved || wasPinching) return;
            const hit = clusterNearest(clusters, localX(event.currentTarget, event.clientX));
            onSelect(hit?.representative.object.id);
          }}
          onPointerCancel={(event) => endPointer(event)}
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
              {labelledTicks.has(tick.exponent) && (
                <text
                  x={tick.x}
                  y={AXIS_Y + 24}
                  fontSize={TICK_FONT_SIZE}
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
          Click a marker to select it, or pick one by name above. Drag to pan, scroll to zoom, or
          focus the axis and use the keyboard. {KEYBOARD_HINT} {clusteredCount(clusters)} of{' '}
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
                    {selectedLength?.range !== undefined && (
                      <>
                        <br />
                        <small>
                          ranges {formatEngineering(selectedLength.range.min).text} to{' '}
                          {formatEngineering(selectedLength.range.max).text}
                        </small>
                      </>
                    )}
                    {/* The axis places an object at one number, so an object
                        with two lengths is drawn by one of them and silent
                        about the other. Naming both, and which one the marker
                        stands at, is the difference between a choice and an
                        accident. */}
                    {otherLengths.length > 0 && (
                      <>
                        <br />
                        <small>
                          placed by its {selectedLength?.key}; also{' '}
                          {otherLengths
                            .map((one) => `${one.key} ${formatEngineering(one.value).text}`)
                            .join(', ')}
                        </small>
                      </>
                    )}
                  </td>
                </tr>
                {/* A number shown without saying what backs it is presented with
                    the same certainty as one that is defined. The schema exists
                    to stop that, and only works if the view says so. */}
                {selectedLength !== undefined && (
                  <tr>
                    <th scope="row">Where it comes from</th>
                    <td>
                      {provenanceSummary(selectedLength)}
                      {selectedLength.note !== undefined && (
                        <>
                          {' '}
                          <small>{selectedLength.note}</small>
                        </>
                      )}
                    </td>
                  </tr>
                )}
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
