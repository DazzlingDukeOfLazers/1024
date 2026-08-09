/**
 * Dimensions in scope for v0.
 *
 * docs/ARCHITECTURE.md: length and time only. Mass/volume come later, but
 * nothing here bakes "length" into object identity (docs/DATA_MODEL.md).
 */

export const DIMENSION_KINDS = ['length', 'time'] as const;

export type DimensionKind = (typeof DIMENSION_KINDS)[number];

export interface DimensionDescriptor {
  kind: DimensionKind;
  /** Canonical SI unit symbol; all exact values are stored in this unit. */
  canonicalUnit: string;
  label: string;
}

export const DIMENSIONS: Readonly<Record<DimensionKind, DimensionDescriptor>> = {
  length: { kind: 'length', canonicalUnit: 'm', label: 'Length' },
  time: { kind: 'time', canonicalUnit: 's', label: 'Time' },
};

export function isDimensionKind(value: string): value is DimensionKind {
  return (DIMENSION_KINDS as readonly string[]).includes(value);
}

export function canonicalUnitOf(dimension: DimensionKind): string {
  return DIMENSIONS[dimension].canonicalUnit;
}
