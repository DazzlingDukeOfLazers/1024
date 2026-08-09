/**
 * The five primary lenses from docs/UI_SPEC.md.
 *
 * Lens identity is part of the versioned share-state schema (Milestone 8), so
 * these ids are stable strings rather than array indices.
 */
export const LENS_IDS = ['atlas', 'ruler', 'comparator', 'microscope', 'lab'] as const;

export type LensId = (typeof LENS_IDS)[number];

export interface LensDescriptor {
  id: LensId;
  title: string;
  /** The question this lens exists to answer. */
  question: string;
}

export const LENSES: readonly LensDescriptor[] = [
  { id: 'atlas', title: 'Scale Atlas', question: 'What order of magnitude is this?' },
  {
    id: 'ruler',
    title: 'Metric Ruler',
    question: 'What does the actual size difference look like?',
  },
  { id: 'comparator', title: 'Comparator', question: 'How many X make Y?' },
  {
    id: 'microscope',
    title: 'Numerical Microscope',
    question: 'What numbers can this representation see here?',
  },
  {
    id: 'lab',
    title: 'Representation Lab',
    question: 'How do different number systems drift?',
  },
];

export function isLensId(value: string): value is LensId {
  return (LENS_IDS as readonly string[]).includes(value);
}
