/**
 * The complete shareable view state.
 *
 * docs/DATA_MODEL.md "Share-state model" and docs/NUMERICS.md §14: the lens,
 * the selection and comparison, the experiment, the representation
 * configuration, the camera, and any display setting that changes how a value
 * is *interpreted*.
 *
 * This type exists so there is exactly one answer to "what is the current
 * view?". A lens that keeps view state to itself is a lens whose state cannot
 * be shared, so every lens is driven from here.
 */

import { type LinearCamera } from '../camera/camera';
import { type LogCamera } from '../camera/logCamera';
import { type LensId } from '../ui/lenses';
import { type ComparisonOperation, type SubjectChoice } from '../features/comparator/compare';
import { defaultRulerCamera } from '../features/ruler/presets';
import { fullRangeCamera } from '../features/atlas/atlas';
import { BUILT_IN_EXPERIMENTS } from '../core/experiments/fixtures';
import { Q128_128_PRESETS, type Q128_128PresetName } from '../core/representations/q128_128';

export interface RulerState {
  readonly presetId: string;
  readonly camera: LinearCamera;
}

export interface AtlasState {
  readonly camera: LogCamera;
}

export interface ComparatorState {
  readonly a: SubjectChoice;
  readonly b: SubjectChoice;
  readonly operation: ComparisonOperation;
  /** Kept as typed text so a half-finished entry survives a re-render. */
  readonly countText: string;
}

export interface LabState {
  readonly experimentId: string;
  /** The value being inspected, as typed. */
  readonly literal: string;
  /** Unit the literal is in — part of what the value *means*. */
  readonly unit: string;
  /** Display-only: which unit the exact core panel reads the value back in. */
  readonly displayUnit: string;
}

export interface RepresentationState {
  /**
   * Which Q128.128 machine the lab emphasises. Changing this changes the
   * machine, not the display (docs/NUMERICS.md §5), so it is part of the state.
   */
  readonly q128Preset: Q128_128PresetName;
}

export interface AppState {
  readonly lens: LensId;
  readonly selectedObjectId?: string | undefined;
  readonly atlas: AtlasState;
  readonly ruler: RulerState;
  readonly comparator: ComparatorState;
  readonly lab: LabState;
  readonly representations: RepresentationState;
}

export function defaultAppState(): AppState {
  return {
    lens: 'atlas',
    atlas: { camera: fullRangeCamera() },
    ruler: { presetId: 'rbc-across-mm', camera: defaultRulerCamera() },
    comparator: {
      a: { kind: 'object', id: 'red-blood-cell' },
      b: { kind: 'unit', symbol: 'mm' },
      operation: 'how-many-fit',
      countText: '123',
    },
    lab: {
      experimentId: BUILT_IN_EXPERIMENTS[0]?.id ?? '',
      literal: '0.1',
      unit: 'm',
      displayUnit: 'mm',
    },
    representations: { q128Preset: 'm' },
  };
}

export function isQ128PresetName(value: string): value is Q128_128PresetName {
  return Object.hasOwn(Q128_128_PRESETS, value);
}
