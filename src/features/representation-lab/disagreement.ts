/**
 * Zoom to Disagreement.
 *
 * PROJECT_SPEC §8: every representation starts at the same apparent position,
 * and zooming in separates them. docs/UI_SPEC.md §5 adds the condition that
 * makes it honest — the magnification must always be disclosed, so a
 * 10^18× exaggeration is never mistaken for a large physical error.
 *
 * The magnification reported here is computed from the cameras that are
 * *actually drawn with*, not from the ideal ones, so the disclosed figure
 * always describes the picture on screen.
 */

import {
  type Rational,
  ONE,
  ZERO,
  abs,
  compare,
  div,
  isZero,
  max as maxRational,
  mul,
  rational,
  sub,
} from '../../core/rational/rational';
import {
  type LinearCamera,
  type Viewport,
  frameLength,
  metersPerPixel,
  toScreenX,
} from '../../camera/camera';

export interface MachineReading {
  readonly id: string;
  readonly label: string;
  /** Absent when the machine holds no rational value at all. */
  readonly decoded?: Rational | undefined;
}

export interface MachinePoint {
  readonly id: string;
  readonly label: string;
  readonly decoded?: Rational | undefined;
  /** `decoded - exact`. Absent when the machine holds no rational. */
  readonly divergence?: Rational | undefined;
  /** Screen position under the active camera. Absent when unplaceable. */
  readonly x?: number | undefined;
  /** True when the point sits outside the drawn area. */
  readonly offScreen: boolean;
}

export interface DisagreementView {
  readonly exact: Rational;
  /** The camera actually in use. */
  readonly camera: LinearCamera;
  /** True scale: the value framed at its own magnitude. */
  readonly naturalCamera: LinearCamera;
  /** Zoomed until the widest divergence is plainly visible. */
  readonly zoomedCamera: LinearCamera;
  /**
   * How much the drawn separation is exaggerated relative to true scale.
   * Exactly 1 when nothing is magnified.
   */
  readonly magnification: Rational;
  readonly magnified: boolean;
  /** Largest `|decoded - exact|` across the machines. */
  readonly maxDivergence: Rational;
  /** True when every machine landed exactly on the reference. */
  readonly agreed: boolean;
  readonly points: readonly MachinePoint[];
  readonly exactX: number;
}

/** Pixels of slack before a point counts as off the drawing. */
const OFF_SCREEN_MARGIN = 40;

/**
 * At true scale the value is framed at its own magnitude, which is exactly why
 * the machines pile up on one pixel: the error really is that small.
 */
function naturalScaleCamera(exact: Rational, spread: Rational, viewport: Viewport): LinearCamera {
  const context = maxRational(abs(exact), spread);
  return frameLength(exact, isZero(context) ? ONE : context, viewport, 0.8);
}

export function buildDisagreementView(
  exact: Rational,
  machines: readonly MachineReading[],
  viewport: Viewport,
  zoomed: boolean,
): DisagreementView {
  const divergences = machines.map((machine) =>
    machine.decoded === undefined ? undefined : sub(machine.decoded, exact),
  );
  const maxDivergence = divergences.reduce<Rational>(
    (widest, divergence) =>
      divergence === undefined ? widest : maxRational(widest, abs(divergence)),
    ZERO,
  );
  const agreed = isZero(maxDivergence);

  const naturalCamera = naturalScaleCamera(exact, maxDivergence, viewport);
  // Frame four times the widest divergence, so the spread lands across roughly
  // two thirds of the drawing with room to label the ends.
  const zoomedCamera = agreed
    ? naturalCamera
    : frameLength(exact, mul(maxDivergence, rational(4n)), viewport, 0.8);

  const camera = zoomed && !agreed ? zoomedCamera : naturalCamera;

  // Both are exact rationals derived from the cameras in hand, so the disclosed
  // figure describes the picture rather than an intention.
  const magnification = div(metersPerPixel(naturalCamera), metersPerPixel(camera));

  const points: MachinePoint[] = machines.map((machine, index) => {
    const divergence = divergences[index];
    if (machine.decoded === undefined) {
      return { id: machine.id, label: machine.label, offScreen: true };
    }
    const x = toScreenX(camera, machine.decoded, viewport);
    return {
      id: machine.id,
      label: machine.label,
      decoded: machine.decoded,
      divergence,
      x,
      offScreen:
        !Number.isFinite(x) || x < -OFF_SCREEN_MARGIN || x > viewport.widthPx + OFF_SCREEN_MARGIN,
    };
  });

  return {
    exact,
    camera,
    naturalCamera,
    zoomedCamera,
    magnification,
    magnified: compare(magnification, ONE) > 0,
    maxDivergence,
    agreed,
    points,
    exactX: toScreenX(camera, exact, viewport),
  };
}

/**
 * How far apart the two most widely separated points are drawn, in pixels.
 * The UI uses it to say whether zooming actually achieved anything.
 */
export function drawnSeparationPixels(view: DisagreementView): number {
  const positions = view.points
    .map((point) => point.x)
    .filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (positions.length < 2) return 0;
  return Math.max(...positions) - Math.min(...positions);
}
