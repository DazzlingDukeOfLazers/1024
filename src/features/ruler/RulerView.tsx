/**
 * The Metric Ruler lens.
 *
 * docs/UI_SPEC.md §2: locally linear, true relative scale, with a grid that
 * re-steps as the camera zooms while the scene stays put.
 *
 * Every position on screen comes from `toScreenX`, which subtracts the exact
 * camera origin before anything becomes a `number`. That is what lets the
 * "1 mm beside a 1e20 m origin" preset work at all.
 */

import { useEffect, useRef } from 'react';
import { type Rational, ZERO, mul, rational } from '../../core/rational/rational';
import { quantity } from '../../core/quantities/quantity';
import { formatEngineering } from '../../core/units/format';
import {
  type LinearCamera,
  fromScreenX,
  lengthInPixels,
  metersPerPixel,
  panByPixels,
  toScreenX,
  visibleWidthMeters,
  zoomAt,
} from '../../camera/camera';
import { chooseGridStep, detailFor, gridLabelUnit, gridTicks } from '../../camera/grid';
import { KEYBOARD_HINT, commandForKey } from '../../camera/keyboard';
import { RulerGrid } from '../../renderers/svg/RulerGrid';
import { CATALOG, requireLength } from '../../catalog/catalog';
import { type RulerState } from '../../share/appState';
import { RULER_VIEWPORT, rulerPresets } from './presets';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const BASELINE = 210;
const ROW_Y = 120;

interface PlacedObject {
  id: string;
  name: string;
  meters: Rational;
  widthPx: number;
  x: number;
}

interface RepeatedRow {
  object: ReturnType<typeof CATALOG.require>;
  size: Rational;
  sizePx: number;
  detail: ReturnType<typeof detailFor>;
  totalAcross: number;
  items: PlacedObject[];
}

export interface RulerViewProps {
  state: RulerState;
  onChange: (update: (current: RulerState) => RulerState) => void;
  /** An object selected in another lens, framed on arrival. */
  focusObjectId?: string | undefined;
}

export function RulerView({ state, onChange, focusObjectId }: RulerViewProps) {
  // One viewBox unit is one CSS pixel, so every pixel figure below is real.
  const [measuredWidth, measure] = useMeasuredWidth(RULER_VIEWPORT.widthPx);
  const VIEWPORT = { widthPx: measuredWidth, heightPx: RULER_VIEWPORT.heightPx };
  const allPresets = rulerPresets(focusObjectId, VIEWPORT);
  const presetId = state.presetId;
  const preset = allPresets.find((entry) => entry.id === presetId) ?? allPresets[0]!;

  const camera = state.camera;
  // The camera lives in app state so it can be shared. The updater form means
  // an event handler never has to read the current camera through a ref.
  const setCamera = (next: LinearCamera | ((current: LinearCamera) => LinearCamera)): void => {
    onChange((current) => ({
      presetId: current.presetId,
      camera: typeof next === 'function' ? next(current.camera) : next,
    }));
  };
  const dragState = useRef<{ x: number } | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);

  const selectPreset = (id: string): void => {
    const next = allPresets.find((entry) => entry.id === id) ?? allPresets[0]!;
    onChange(() => ({ presetId: id, camera: next.camera }));
  };

  const step = chooseGridStep(camera);
  const unit = gridLabelUnit(step);
  const toScreen = (meters: Rational): number => toScreenX(camera, meters, VIEWPORT);
  const ticks = gridTicks(camera, VIEWPORT, step, toScreen);

  /* ---------------------------------------------------------------------- */
  /* Objects laid out end to end                                            */
  /* ---------------------------------------------------------------------- */

  const repeated = ((): RepeatedRow | undefined => {
    const repeatObjectId = preset.repeatObjectId;
    if (repeatObjectId === undefined) return undefined;
    const object = CATALOG.require(repeatObjectId);
    const size = requireLength(object).value.value;
    const sizePx = lengthInPixels(camera, size);
    const detail = detailFor(sizePx);

    // The count is a property of the scene, not of the rendering: it is the
    // same whether we draw every item or collapse them into a strip.
    const totalAcross = Math.ceil(VIEWPORT.widthPx / Math.max(sizePx, 1e-9));
    const drawn = detail === 'aggregate' ? 0 : Math.min(totalAcross + 1, 600);

    const items: PlacedObject[] = [];
    for (let index = 0; index < drawn; index += 1) {
      const meters = mul(size, rational(BigInt(index)));
      items.push({
        id: `${object.id}-${index}`,
        name: object.name,
        meters,
        widthPx: sizePx,
        x: toScreen(meters),
      });
    }
    return { object, size, sizePx, detail, totalAcross, items };
  })();

  /* ---------------------------------------------------------------------- */
  /* Catalog objects near this scale                                        */
  /* ---------------------------------------------------------------------- */

  const nearby = CATALOG.byScale()
    .map((object) => ({
      object,
      size: requireLength(object).value.value,
      widthPx: lengthInPixels(camera, requireLength(object).value.value),
    }))
    // Anything below two pixels or wider than the viewport is not usefully
    // drawn at this zoom.
    .filter(({ widthPx }) => widthPx >= 2 && widthPx <= VIEWPORT.widthPx)
    .slice(0, 6);

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Viewport-space x for a pointer event. Always call this *before* handing
   * anything to `setCamera`: React nulls `currentTarget` once the handler
   * returns, and a state updater can be re-run after that.
   */
  const localX = (element: Element, clientX: number): number => {
    const bounds = element.getBoundingClientRect();
    return ((clientX - bounds.left) / bounds.width) * VIEWPORT.widthPx;
  };

  // React attaches its wheel listener passively, so `preventDefault` inside an
  // onWheel prop silently does nothing and the page scrolls instead of zooming.
  // A non-passive listener is the only way to own the gesture.
  useEffect(() => {
    const element = svgRef.current;
    if (element === null) return undefined;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      // Measured here rather than closed over, so a resize cannot leave the
      // listener zooming against a width the view no longer has. One viewBox
      // unit is one CSS pixel, so the offset needs no scaling.
      const bounds = element.getBoundingClientRect();
      const viewport = { widthPx: bounds.width, heightPx: RULER_VIEWPORT.heightPx };
      const x = event.clientX - bounds.left;
      const delta = event.deltaY * 0.002;
      // `onChange` directly rather than the `setCamera` wrapper, so the effect
      // depends only on a stable prop and attaches the listener once.
      onChange((current) => ({
        presetId: current.presetId,
        camera: zoomAt(current.camera, delta, x, viewport),
      }));
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
      onChange(() => ({ presetId, camera: preset.camera }));
      return;
    }
    if (command.kind === 'pan') {
      setCamera((current) => panByPixels(current, command.pixels));
      return;
    }
    setCamera((current) => zoomAt(current, -command.steps * 0.2, VIEWPORT.widthPx / 2, VIEWPORT));
  };

  return (
    <>
      <section className="panel" ref={measure}>
        <div className="field">
          <label htmlFor="ruler-preset">Preset</label>
          <select
            id="ruler-preset"
            value={presetId}
            onChange={(event) => selectPreset(event.target.value)}
          >
            {allPresets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(() => ({ presetId, camera: preset.camera }))}
          >
            Reset view
          </button>
        </div>
        <p className="lens-question">{preset.description}</p>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWPORT.widthPx} ${VIEWPORT.heightPx}`}
          width="100%"
          className="ruler"
          role="application"
          tabIndex={0}
          aria-label={`Metric ruler. ${KEYBOARD_HINT}`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragState.current = { x: localX(event.currentTarget, event.clientX) };
          }}
          onPointerMove={(event) => {
            if (dragState.current === undefined) return;
            const x = localX(event.currentTarget, event.clientX);
            const delta = x - dragState.current.x;
            dragState.current = { x };
            setCamera((current) => panByPixels(current, delta));
          }}
          onPointerUp={() => {
            dragState.current = undefined;
          }}
          onPointerCancel={() => {
            dragState.current = undefined;
          }}
        >
          <RulerGrid
            ticks={ticks}
            unitSymbol={unit.symbol}
            width={VIEWPORT.widthPx}
            height={VIEWPORT.heightPx}
            baseline={BASELINE}
          />

          {repeated !== undefined && repeated.detail === 'aggregate' && (
            <g>
              <rect
                x={0}
                y={ROW_Y - 10}
                width={VIEWPORT.widthPx}
                height={20}
                fill="currentColor"
                fillOpacity={0.22}
              />
              <text x={8} y={ROW_Y + 4} fontSize={11} fill="currentColor">
                {repeated.object.name} — below a pixel here, drawn as density
              </text>
            </g>
          )}

          {repeated !== undefined &&
            repeated.detail !== 'aggregate' &&
            repeated.items.map((item) =>
              repeated.detail === 'detailed' ? (
                <ellipse
                  key={item.id}
                  cx={item.x + item.widthPx / 2}
                  cy={ROW_Y}
                  rx={Math.max(item.widthPx / 2 - 1, 0.5)}
                  ry={Math.max(item.widthPx / 4, 0.5)}
                  fill="currentColor"
                  fillOpacity={0.5}
                />
              ) : (
                <rect
                  key={item.id}
                  x={item.x}
                  y={ROW_Y - 6}
                  width={Math.max(item.widthPx - 0.5, 0.5)}
                  height={12}
                  fill="currentColor"
                  fillOpacity={0.45}
                />
              ),
            )}

          {repeated === undefined &&
            nearby.map((entry, index) => {
              const x = toScreen(ZERO);
              return (
                <g key={entry.object.id}>
                  <rect
                    x={x}
                    y={40 + index * 22}
                    width={Math.max(entry.widthPx, 1)}
                    height={14}
                    fill="currentColor"
                    fillOpacity={0.4}
                  />
                  <text x={x + 4} y={40 + index * 22 + 11} fontSize={10} fill="currentColor">
                    {entry.object.name} — {formatEngineering(quantity('length', entry.size)).text}
                  </text>
                </g>
              );
            })}
        </svg>
      </section>

      <section className="panel">
        <h3>Camera</h3>
        <table className="readout">
          <tbody>
            <tr>
              <th scope="row">Centre</th>
              <td className="mono">
                {
                  formatEngineering(quantity('length', camera.centerMeters), {
                    significantDigits: 8,
                  }).text
                }
              </td>
            </tr>
            <tr>
              <th scope="row">Scale</th>
              <td className="mono">
                {formatEngineering(quantity('length', metersPerPixel(camera))).text} per pixel
              </td>
            </tr>
            <tr>
              <th scope="row">Across the view</th>
              <td className="mono">
                {formatEngineering(quantity('length', visibleWidthMeters(camera, VIEWPORT))).text}
              </td>
            </tr>
            <tr>
              <th scope="row">Grid step</th>
              <td className="mono">
                {formatEngineering(quantity('length', step.spacing)).text} — labelled in{' '}
                {unit.symbol}, {Math.round(step.pixels)} px apart
              </td>
            </tr>
            {repeated !== undefined && (
              <tr>
                <th scope="row">Level of detail</th>
                <td className="mono">
                  {repeated.detail} at {repeated.sizePx.toFixed(2)} px per{' '}
                  {repeated.object.name.toLowerCase()}
                  <br />
                  <small>
                    {repeated.totalAcross.toLocaleString()} would span the view; the count is the
                    same at every level of detail.
                  </small>
                </td>
              </tr>
            )}
            <tr>
              <th scope="row">Left edge</th>
              <td className="mono">
                {
                  formatEngineering(quantity('length', fromScreenX(camera, 0, VIEWPORT)), {
                    significantDigits: 8,
                  }).text
                }
              </td>
            </tr>
          </tbody>
        </table>
        <p className="lens-question">
          Drag to pan, scroll to zoom, or focus the ruler and use the keyboard. {KEYBOARD_HINT} The
          centre is an exact rational, so panning out and back returns to exactly where it started —
          and a millimetre stays resolvable however far from zero the camera sits.
        </p>
      </section>
    </>
  );
}
