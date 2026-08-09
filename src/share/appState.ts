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
import { type DigitWidth } from '../core/wide/digits';
import { type ScenarioName } from '../core/wide/scenario';

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
  /**
   * Whether the divergence strip is magnified. This changes what the picture
   * means, so it is part of the shareable state (docs/UI_SPEC.md §5).
   */
  readonly zoomToDisagreement: boolean;
}

export interface MicroscopeState {
  /** The magnitude being inspected, as typed. */
  readonly literal: string;
  /** Unit the literal is in — part of what the value means. */
  readonly unit: string;
}

/**
 * docs/WIDE_INTEGER_ARCHITECTURE.md. The operands are kept as typed decimal
 * strings for the same reason every other literal in this app is: they are what
 * the user asked for, and parsing them to a number on the way in would be the
 * mistake the whole project is about.
 */
export interface ArchitectureState {
  readonly aLiteral: string;
  readonly bLiteral: string;
  readonly digitBits: DigitWidth;
  readonly scenario: ScenarioName;
  readonly skipZeroDigits: boolean;
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
  readonly microscope: MicroscopeState;
  readonly architecture: ArchitectureState;
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
      zoomToDisagreement: false,
    },
    microscope: { literal: '1', unit: 'm' },
    architecture: {
      // Sparse on purpose: two set bits in a 1024-bit register is §4's own
      // example, and it is what makes the multiplication matrix worth drawing.
      aLiteral: '2^700 + 2^12',
      bLiteral: '2^300 + 1',
      digitBits: 64,
      scenario: 'round',
      skipZeroDigits: true,
    },
    representations: { q128Preset: 'm' },
  };
}

export function isQ128PresetName(value: string): value is Q128_128PresetName {
  return Object.hasOwn(Q128_128_PRESETS, value);
}
