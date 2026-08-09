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

import { type Rational, div, rational } from '../rational/rational';
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

/** Relative standard uncertainty, for display next to (never inside) error figures. */
export function relativeUncertainty(constant: DeclaredConstant): Rational | undefined {
  const { uncertainty, nominal } = constant;
  if (uncertainty === undefined) return undefined;
  if (uncertainty.kind === 'relative') return uncertainty.value;
  return div(uncertainty.value, nominal);
}
