/**
 * What the §17 lane panel can draw, and what each operation puts on the wire
 * between lanes.
 *
 * The panel's one idea is that a 1024-bit register is 32 lanes and an operation
 * is what those lanes have to tell each other. For ADD that is a carry, for SUB
 * a borrow, for MUL_WIDE the value each row of the schoolbook multiply leaves
 * above itself. Every one of those is *traced by the kernel* rather than
 * re-derived here, because a second implementation of a carry rule is a second
 * thing that can be wrong (§18).
 *
 * DIV_REM is in the list and deliberately has no marker, which is the honest
 * answer rather than a gap: a restoring division's lanes do not pass each other
 * a carry at all. Its inter-lane traffic is a shift and a comparison across the
 * whole register, and drawing a dot per lane would be inventing a signal to
 * keep the picture uniform.
 */

export const COMPUTE_OPS = ['add', 'sub', 'mulWide', 'divRem'] as const;
export type ComputeOp = (typeof COMPUTE_OPS)[number];

export function isComputeOp(value: unknown): value is ComputeOp {
  return typeof value === 'string' && (COMPUTE_OPS as readonly string[]).includes(value);
}

export interface ComputeOpDescription {
  readonly label: string;
  /** What the strip's rows are. */
  readonly result: string;
  /** What a marker on a lane means, or `undefined` when there is none to draw. */
  readonly marker?: string;
  /** Why there is no marker, when there is not. */
  readonly noMarker?: string;
}

export const COMPUTE_OP_DESCRIPTIONS: Readonly<Record<ComputeOp, ComputeOpDescription>> = {
  add: {
    label: 'A + B',
    result: 'the 32-lane sum',
    marker: 'the lane emitted a carry',
  },
  sub: {
    label: 'A − B',
    result: 'the 32-lane difference, wrapping mod 2^1024',
    marker: 'the lane took a borrow from the one above it',
  },
  mulWide: {
    label: 'A × B',
    result: 'the 64-lane product — nothing dropped',
    marker: 'a row of the multiply left a carry in this lane',
  },
  divRem: {
    label: 'A ÷ B',
    result: 'the 32-lane quotient, then the 32-lane remainder',
    noMarker:
      'a restoring division does not pass a carry between lanes: its traffic is a shift and a ' +
      'comparison across the whole register, so there is nothing per-lane to mark, and a dot ' +
      'here would be invented to keep the picture uniform',
  },
};
