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
import {
  chooseGridStep,
  detailFor,
  formatGridOffset,
  gridLabelUnit,
  gridTicks,
} from '../../camera/grid';
import { KEYBOARD_HINT, commandForKey } from '../../camera/keyboard';
import { type Pinch, pinchLog10Delta, pinchOf } from '../../camera/pinch';
import { estimateTextWidth } from '../../camera/labels';
import { RulerGrid } from '../../renderers/svg/RulerGrid';
import { CATALOG, requireLength } from '../../catalog/catalog';
import { relationsAmong } from '../../catalog/graph';
import { provenanceSummary } from '../../catalog/schema';
import { type RulerState } from '../../share/appState';
import { RULER_VIEWPORT, rulerPresets } from './presets';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const BASELINE = 210;
const ROW_Y = 120;
/** Must match the `fontSize` the object rows draw at, or the width estimate is of the wrong text. */
const OBJECT_LABEL_FONT_SIZE = 10;

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
  /** Every pointer currently down, by id, at its position in view pixels. */
  const pointers = useRef(new Map<number, number>());
  const pinchState = useRef<Pinch | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);

  const selectPreset = (id: string): void => {
    const next = allPresets.find((entry) => entry.id === id) ?? allPresets[0]!;
    onChange(() => ({ presetId: id, camera: next.camera }));
  };

  const step = chooseGridStep(camera);
  const unit = gridLabelUnit(step);
  const toScreen = (meters: Rational): number => toScreenX(camera, meters, VIEWPORT);
  const grid = gridTicks(camera, VIEWPORT, step, toScreen);
  // The shared part of the tick labels, when there is one. Shown in the same
  // unit as the ticks, so a reader adds two numbers of the same kind rather
  // than converting between them.
  const offsetLabel = grid.offset === undefined ? undefined : formatGridOffset(grid.offset, unit);

  /* ---------------------------------------------------------------------- */
  /* Objects laid out end to end                                            */
  /* ---------------------------------------------------------------------- */

  const repeatedLength =
    preset.repeatObjectId === undefined
      ? undefined
      : requireLength(CATALOG.require(preset.repeatObjectId));

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
    // Measured: at 28 objects this cap never bites — no zoom from 1e-12 to
    // 1e24 m/px puts more than six in range at either width. It would drop the
    // *largest* ones if it did, which are the ones this lens is about, so it
    // wants revisiting alongside a bigger catalog rather than left as a silent
    // truncation.
    .slice(0, 6);

  // Every bar is anchored at zero, so at a far origin the whole set can be off
  // screen. Culling here rather than inside the render keeps the stacked rows
  // gapless and lets the panel below describe what is actually drawn.
  const drawn = nearby.filter(({ widthPx }) => {
    const x = toScreen(ZERO);
    return !(x + Math.max(widthPx, 1) < 0 || x > VIEWPORT.widthPx);
  });

  // Which of them are connected to each other, and which are here by size
  // alone. Five objects stacked at true scale read as a family; three of these
  // usually are and the rest are a coincidence of magnitude.
  const among = relationsAmong(
    CATALOG,
    drawn.map((entry) => entry.object.id),
  );
  const connected = drawn.filter((entry) => (among.get(entry.object.id) ?? []).length > 0);

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

  /**
   * Capture is a convenience, not a requirement: it keeps a finger that strays
   * outside the element still steering the camera. A pointer the browser does
   * not know about — a synthetic one from a test — cannot be captured, and that
   * must not take the gesture down with it.
   */
  const capture = (event: React.PointerEvent<SVGSVGElement>): void => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable; the gesture works without it */
    }
  };

  const endPointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    pinchState.current = undefined;
    // Lifting one of two fingers hands the drag to the one still down, so the
    // view continues from where it is rather than jumping.
    const remaining = [...pointers.current.values()];
    dragState.current = remaining.length === 1 ? { x: remaining[0]! } : undefined;
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
            capture(event);
            const x = localX(event.currentTarget, event.clientX);
            pointers.current.set(event.pointerId, x);
            const pinch = pinchOf([...pointers.current.values()]);
            // A second finger ends the drag and starts a pinch, rather than
            // both running at once and fighting over the camera.
            pinchState.current = pinch;
            dragState.current = pinch === undefined ? { x } : undefined;
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
              const delta = pinchLog10Delta(previous, pinch);
              setCamera((current) =>
                zoomAt(panByPixels(current, panPixels), delta, pinch.center, VIEWPORT),
              );
              return;
            }

            if (dragState.current === undefined) return;
            const drag = x - dragState.current.x;
            dragState.current = { x };
            setCamera((current) => panByPixels(current, drag));
          }}
          onPointerUp={(event) => endPointer(event)}
          onPointerCancel={(event) => endPointer(event)}
        >
          <RulerGrid
            ticks={grid.ticks}
            unitSymbol={unit.symbol}
            offsetLabel={offsetLabel}
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
            drawn.map((entry, index) => {
              const x = toScreen(ZERO);
              const barWidth = Math.max(entry.widthPx, 1);
              // A bar anchored at zero is often mostly off-screen — at a 1e20 m
              // origin, entirely so — and its label used to follow it over the
              // edge. The label belongs to the bar, so it is pinned inside the
              // view while any of the bar is, and dropped when the view is too
              // narrow to hold it.
              const text = `${entry.object.name} — ${
                formatEngineering(quantity('length', entry.size)).text
              }`;
              const textWidth = estimateTextWidth(text, OBJECT_LABEL_FONT_SIZE);
              const rightmost = VIEWPORT.widthPx - textWidth - 4;
              const labelX = Math.min(Math.max(x + 4, 4), rightmost);
              return (
                <g key={entry.object.id}>
                  <rect
                    x={x}
                    y={40 + index * 22}
                    width={barWidth}
                    height={14}
                    fill="currentColor"
                    fillOpacity={0.4}
                  />
                  {rightmost >= 4 && (
                    <text
                      x={labelX}
                      y={40 + index * 22 + 11}
                      fontSize={OBJECT_LABEL_FONT_SIZE}
                      fill="currentColor"
                    >
                      {text}
                    </text>
                  )}
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
            {/* The ruler draws these to scale, which is a strong claim about a
                number the reader did not choose. It has to say where it came
                from, in the same words the other lenses use. */}
            {repeated !== undefined && repeatedLength !== undefined && (
              <tr>
                <th scope="row">{repeated.object.name} size</th>
                <td>
                  {formatEngineering(repeatedLength.value).text}
                  {repeatedLength.range !== undefined && (
                    <>
                      {' '}
                      <small>
                        ({formatEngineering(repeatedLength.range.min).text} to{' '}
                        {formatEngineering(repeatedLength.range.max).text})
                      </small>
                    </>
                  )}
                  <br />
                  <small>{provenanceSummary(repeatedLength)}</small>
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

      {/* Metric navigation put these objects side by side; the graph says which
          of them belong together. At true scale that is the more striking place
          to draw the distinction than the Atlas — a hand really is that
          fraction of a human, and a coconut really is that size by accident. */}
      {repeated === undefined && (
        <section className="panel">
          <h3>Drawn together</h3>
          {/* Two different reasons for an empty picture, and saying the wrong
              one is worse than saying nothing. At a 1e20 m origin the objects
              are exactly the right size to draw — a grain of sand is 50 px
              here — and what removes them is that the ruler measures from zero
              and zero is twenty decades away. */}
          {drawn.length === 0 ? (
            nearby.length === 0 ? (
              <p className="lens-question">
                Nothing in the catalog is between two pixels and a full view wide here, so the ruler
                is drawing the grid alone.
              </p>
            ) : (
              <p className="lens-question">
                {nearby.length} {nearby.length === 1 ? 'object is' : 'objects are'} the right size
                to draw at this scale, and none is on screen: the ruler measures them from zero, and
                zero is {formatEngineering(quantity('length', camera.centerMeters)).text} away.
              </p>
            )
          ) : (
            <>
              <table className="readout">
                <thead>
                  <tr>
                    <th scope="col">Object</th>
                    <th scope="col">Size</th>
                    <th scope="col">Related to what else is drawn</th>
                  </tr>
                </thead>
                <tbody>
                  {drawn.map((entry) => {
                    const edges = among.get(entry.object.id) ?? [];
                    return (
                      <tr key={entry.object.id}>
                        <th scope="row">{entry.object.name}</th>
                        <td className="mono">
                          {formatEngineering(quantity('length', entry.size)).text}
                        </td>
                        <td>
                          {edges.length === 0 ? (
                            <small>here by size alone</small>
                          ) : (
                            edges
                              .map((edge) => `${edge.label} ${edge.target.name.toLowerCase()}`)
                              .join(', ')
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="lens-question">
                {connected.length === 0
                  ? `None of these ${drawn.length} objects is related to another one here. Being the same size is not a relationship, and the ruler chose them by size.`
                  : `${connected.length} of the ${drawn.length} objects drawn are related to each other. The rest are here by size alone — the ruler chooses what to draw by magnitude, and the graph is what says which neighbours mean anything.`}
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
