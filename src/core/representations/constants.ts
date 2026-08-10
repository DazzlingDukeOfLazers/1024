/**
 * Declared physical constants.
 *
 * docs/NUMERICS.md §3: constants a simulated machine depends on are *declared
 * inputs*, not mathematical truths the application manufactures. Each carries
 * provenance, declared digits and measurement uncertainty.
 *
 * The critical separation: a machine's quantization error is computed **given**
 * the chosen nominal value. The constant's own measurement uncertainty is a
 * different quantity and must never be folded into an ErrorLedger.
 *
 *     physical/model uncertainty != numerical representation error
 */

import { type Rational, add, div, mul, rational } from '../rational/rational';
import { parseDecimalExact } from '../rational/parse';

export interface DeclaredConstant {
  id: string;
  /** The decimal declaration, encoded exactly as a rational. */
  nominal: Rational;
  unit: string;
  source: string;
  sourceVersion: string;
  /** Significant digits in the published declaration. */
  declaredDigits: number;
  uncertainty?: {
    kind: 'absolute' | 'relative';
    value: Rational;
  };
}

/**
 * Speed of light. Exact by SI definition since 1983 — the metre is defined from
 * it — so this one genuinely has no uncertainty.
 */
export const SPEED_OF_LIGHT: DeclaredConstant = {
  id: 'c',
  nominal: rational(299792458n),
  unit: 'm/s',
  source: 'SI definition',
  sourceVersion: '2019',
  declaredDigits: 9,
};

/**
 * Planck length. The published value is dominated by the uncertainty in G, so
 * unlike `c` this is a measurement, and the Planck machine's grid is only as
 * meaningful as this declaration.
 */
export const PLANCK_LENGTH: DeclaredConstant = {
  id: 'planck-length',
  nominal: parseDecimalExact('1.616255e-35'),
  unit: 'm',
  source: 'CODATA',
  sourceVersion: '2018',
  declaredDigits: 7,
  uncertainty: { kind: 'absolute', value: parseDecimalExact('0.000018e-35') },
};

export const PLANCK_TIME: DeclaredConstant = {
  id: 'planck-time',
  nominal: parseDecimalExact('5.391247e-44'),
  unit: 's',
  source: 'CODATA',
  sourceVersion: '2018',
  declaredDigits: 7,
  uncertainty: { kind: 'absolute', value: parseDecimalExact('0.000060e-44') },
};

/**
 * The frozen constant set a Planck experiment is conditioned on. Freezing the
 * whole set together, with a version, is what makes an experiment's numbers
 * reproducible and comparable across runs (docs/NUMERICS.md §3).
 */
export interface ConstantSet {
  id: string;
  planckLength: DeclaredConstant;
  planckTime: DeclaredConstant;
  speedOfLight: DeclaredConstant;
}

export const CODATA_2018: ConstantSet = {
  id: 'codata-2018',
  planckLength: PLANCK_LENGTH,
  planckTime: PLANCK_TIME,
  speedOfLight: SPEED_OF_LIGHT,
};

/**
 * The same constant, one standard uncertainty higher.
 *
 * Computed rather than written down. `1.616255e-35 + 0.000018e-35` is easy
 * arithmetic and a transcription risk for no gain, and deriving it means the
 * second declaration cannot drift away from the first if the first is ever
 * updated. Exact rational addition, so the derived nominal is as exact as the
 * published one.
 *
 * An exact constant has no uncertainty and comes back unchanged, which is the
 * right answer rather than a special case: `c` is a definition.
 */
export function atPlusOneSigma(constant: DeclaredConstant): DeclaredConstant {
  const { uncertainty } = constant;
  if (uncertainty === undefined) return constant;
  const absolute =
    uncertainty.kind === 'absolute' ? uncertainty.value : mul(uncertainty.value, constant.nominal);
  return {
    ...constant,
    id: `${constant.id}+1sigma`,
    nominal: add(constant.nominal, absolute),
    source:
      `${constant.source} ${constant.sourceVersion} nominal plus one standard ` +
      `uncertainty — not a recommended value`,
    sourceVersion: `${constant.sourceVersion}+1σ`,
  };
}

/**
 * The same constants one standard uncertainty higher.
 *
 * §3 says quantization is computed *given* the nominal declaration, and the
 * whole Planck machine rests on that sentence. A second set is what turns it
 * from an assertion into something a reader can watch happen: the same 256-bit
 * register, the same value, a different grid.
 *
 * A later CODATA was the obvious second set and it does not work. **CODATA 2022
 * publishes the identical Planck length** — 1.616255(18) × 10^-35 m, digit for
 * digit, because the adjustment did not move G, which is what dominates it.
 * Checked against the NIST page rather than assumed. Two real adjustments that
 * agree to every published digit demonstrate nothing about conditioning.
 *
 * So this set is derived instead, and derived from the constants' *own*
 * published uncertainty rather than from a number chosen to make a point:
 * each nominal plus one standard uncertainty. `c` is unchanged, because it is
 * exact by definition and has no uncertainty to add — which is itself part of
 * the lesson, since a set where every constant moved would suggest they are all
 * the same kind of thing.
 *
 * **Not a recommended value, and never presented as one.** It is a declaration
 * to compare against a declaration.
 */
export const CODATA_2018_PLUS_1SIGMA: ConstantSet = {
  id: 'codata-2018+1σ',
  planckLength: atPlusOneSigma(PLANCK_LENGTH),
  planckTime: atPlusOneSigma(PLANCK_TIME),
  // Through the same function as the others, not written as `SPEED_OF_LIGHT`.
  // It comes back unchanged because it has no uncertainty to add, and letting
  // that happen rather than special-casing it is what makes "an exact constant
  // does not move" a property of the code instead of a claim about the set.
  // Mutation testing found the special case: the pass-through branch was
  // documented and unreachable.
  speedOfLight: atPlusOneSigma(SPEED_OF_LIGHT),
};

/** Every declaration a Planck machine can be conditioned on. */
export const CONSTANT_SETS: readonly ConstantSet[] = [CODATA_2018, CODATA_2018_PLUS_1SIGMA];

/** Relative standard uncertainty, for display next to (never inside) error figures. */
export function relativeUncertainty(constant: DeclaredConstant): Rational | undefined {
  const { uncertainty, nominal } = constant;
  if (uncertainty === undefined) return undefined;
  if (uncertainty.kind === 'relative') return uncertainty.value;
  return div(uncertainty.value, nominal);
}
