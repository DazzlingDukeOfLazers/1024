/**
 * The packing model, declared rather than assumed.
 *
 * "How many coconuts fit in a house" is the question people actually ask, and
 * `how-many-fit` has only ever answered it along a line. TASKS left the volume
 * form out deliberately: the volume ratio alone is not the answer, because
 * spheres do not tile, and offering `V_house / V_coconut` would overstate it by
 * more than half.
 *
 * What was missing was not arithmetic but a citable number. There is one, and
 * it is a *measurement*: pour equal spheres into a large container, shake it
 * down, and they occupy 0.6366 of the volume. That is not a rounding of the
 * theoretical maximum — the densest possible arrangement of equal spheres is
 * π/√18 ≈ 0.7405 (Kepler's conjecture, proved by Hales) — and pouring does not
 * reach it. Two different numbers for two different questions, and the one that
 * fits "how many fit in here" is the poured one.
 *
 * Declared with the same shape as the machine constants in
 * `core/representations/constants.ts`, for the same reason
 * (`docs/NUMERICS.md` §3): a model's number is an input with provenance, not a
 * truth the application manufactures. Kept *out* of `CODATA_2018` and out of any
 * ErrorLedger — that set is what a simulated machine's grid is conditioned on,
 * and a packing fraction has nothing to do with a register.
 */

import { type DeclaredConstant } from '../../core/representations/constants';
import { parseDecimalExact } from '../../core/rational/parse';

/**
 * Random close packing of equal spheres.
 *
 * Scott and Kilgour packed up to 80,000 steel balls with a mechanical vibrator,
 * corrected for boundary effects and extrapolated to infinite volume. The
 * uncertainty is theirs.
 */
export const RANDOM_CLOSE_PACKING: DeclaredConstant = {
  id: 'random-close-packing',
  nominal: parseDecimalExact('0.6366'),
  // Dimensionless: a fraction of a volume, so there is no unit to convert.
  unit: '1',
  source:
    'G D Scott and D M Kilgour, "The density of random close packing of spheres", ' +
    'J. Phys. D: Appl. Phys. 2 (1969) 863',
  sourceVersion: '1969',
  declaredDigits: 4,
  uncertainty: { kind: 'absolute', value: parseDecimalExact('0.0005') },
};

/**
 * The densest packing of equal spheres, for context rather than for arithmetic.
 *
 * π/√18 is irrational, so unlike everything else here it cannot be an exact
 * `Rational` — it is quoted as a decimal in prose and never computed with. A
 * project that refuses to round silently should not make an exception for a
 * number it only wants to mention.
 */
export const DENSEST_SPHERE_PACKING_TEXT = 'about 0.7405 (π/√18)';
