/**
 * Reading a length back off the screen.
 *
 * The views re-step through SI prefixes as they zoom, so two readouts of the
 * same row can differ in unit as well as in digits — `450.5 µm` and `1.577 mm`
 * are the second larger. Comparing the digits alone gets that backwards, which
 * is a way for a test to assert the opposite of what it means to.
 */

const SI_PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  µ: 1e-6,
  m: 1e-3,
  c: 1e-2,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** The first length in a readout, in metres. `NaN` when there is none. */
export function metresIn(text: string): number {
  const match = /(-?[\d.]+)\s*([pnµmckMGTPE]?)m\b/.exec(text);
  if (match === null) return Number.NaN;
  const [, value, prefix] = match;
  return Number(value) * (prefix === '' || prefix === undefined ? 1 : (SI_PREFIX[prefix] ?? 1));
}
