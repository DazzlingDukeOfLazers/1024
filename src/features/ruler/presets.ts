/**
 * Ruler presets.
 *
 * Separated from the view so the app shell can seed a camera without importing
 * a component, and so share-state restoration has something to name.
 */

import { ZERO, mul, rational } from '../../core/rational/rational';
import { parseDecimalExact } from '../../core/rational/parse';
import { fromUnit, quantity } from '../../core/quantities/quantity';
import { formatEngineering } from '../../core/units/format';
import { type LinearCamera, type Viewport, createCamera, frameLength } from '../../camera/camera';
import { CATALOG, requireLength } from '../../catalog/catalog';

export const RULER_VIEWPORT: Viewport = { widthPx: 960, heightPx: 260 };

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly camera: LinearCamera;
  /** Object laid out end to end across the view, if any. */
  readonly repeatObjectId?: string;
}

export function rulerPresets(
  focusObjectId?: string,
  viewport: Viewport = RULER_VIEWPORT,
): Preset[] {
  const coconut = requireLength(CATALOG.require('coconut')).value.value;
  const millimetre = fromUnit(rational(1n), 'mm').value;

  // A selection made in the Atlas arrives here as a preset of its own, framed
  // on the object, so the jump between lenses lands somewhere useful.
  const focused: Preset[] = [];
  const focusObject = focusObjectId === undefined ? undefined : CATALOG.get(focusObjectId);
  if (focusObject !== undefined) {
    const size = requireLength(focusObject).value.value;
    focused.push({
      id: 'selection',
      label: `Selected: ${focusObject.name}`,
      description: `Framed on the selection from the Atlas. ${
        formatEngineering(quantity('length', size)).text
      } across.`,
      camera: frameLength(ZERO, size, viewport, 0.6),
      repeatObjectId: focusObject.id,
    });
  }

  return [
    ...focused,
    {
      id: 'rbc-across-mm',
      label: 'Red blood cells across a millimetre',
      description:
        'About 133 of them. Zoom out and they collapse into a strip; the count never changes.',
      camera: frameLength(ZERO, millimetre, viewport, 0.8),
      repeatObjectId: 'red-blood-cell',
    },
    {
      id: 'coconuts',
      label: '123 coconuts',
      description: 'Twenty-four metres of them, drawn to scale.',
      camera: frameLength(
        mul(coconut, rational(123n, 2n)),
        mul(coconut, rational(123n)),
        viewport,
        0.85,
      ),
      repeatObjectId: 'coconut',
    },
    {
      id: 'far-origin',
      label: 'A millimetre at a 1e20 m origin',
      description:
        'The camera centre is 100 quintillion metres from zero, and a millimetre is still 100 px wide. ' +
        'Converting the positions to doubles first would have lost it entirely.',
      camera: createCamera(parseDecimalExact('1e20'), -5),
    },
    {
      id: 'human-scale',
      label: 'Human scale',
      description: 'A door, a human and a coconut, to scale.',
      camera: frameLength(rational(1n), rational(4n), viewport, 0.8),
    },
  ];
}

/** Starting camera, framed at the nominal width; the view reframes once measured. */
export function defaultRulerCamera(): LinearCamera {
  return rulerPresets()[0]!.camera;
}
