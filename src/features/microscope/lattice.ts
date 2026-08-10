/**
 * The representable-value lattice.
 *
 * docs/UI_SPEC.md §4: "What numbers can this representation see here?"
 *
 * Every representation answers that differently, and the difference is the
 * whole lesson. A fixed-point machine's spacing is constant wherever you stand;
 * binary64's spreads out as the magnitude grows, and its two neighbours are not
 * even the same distance away at a power of two (docs/NUMERICS.md §10).
 *
 * Nothing here decides how to draw anything. It reports what each machine can
 * see, exactly.
 */

import {
  type Rational,
  ZERO,
  abs,
  add,
  equals,
  isZero,
  mul,
  ONE,
  pow2,
  pow10,
  rational,
  sub,
} from '../../core/rational/rational';
import { log10RationalForDisplay } from '../../core/rational/log10';
import {
  type Q128_128Config,
  DEFAULT_Q128_128_CONFIG,
  Q128_128_PRESETS,
  type Q128_128PresetName,
  decodeMeters,
  encodeMeters as encodeQ128,
  physicalLsbMeters,
} from '../../core/representations/q128_128';
import {
  type PlanckConfig,
  DEFAULT_PLANCK_CONFIG,
  encodeMeters as encodePlanck,
} from '../../core/representations/planck';
import {
  MIN_SUBNORMAL_EXPONENT,
  encodeRational,
  exactValue,
  fields,
  isFiniteState,
  neighbors,
  predecessor,
  successor,
  bitsOf,
} from '../../core/representations/binary64';
import { Q128_128, rawHex } from '../../core/representations/fixedPoint';

export interface LatticeSample {
  /** Steps away from the nearest representable value. 0 is the nearest itself. */
  readonly index: number;
  readonly value: Rational;
}

export interface LatticeReport {
  readonly id: string;
  readonly label: string;
  /** The magnitude the user asked about. */
  readonly requested: Rational;
  /** Nearest value this machine can actually hold. Absent when it cannot. */
  readonly nearest?: Rational | undefined;
  /** `nearest - requested`. */
  readonly quantizationError?: Rational | undefined;
  /** Distance from `nearest` down to the previous representable value. */
  readonly gapBelow?: Rational | undefined;
  /** Distance from `nearest` up to the next one. */
  readonly gapAbove?: Rational | undefined;
  /** True when the two gaps differ — binary64 at a power of two. */
  readonly asymmetric: boolean;
  /** Set when the machine's spacing is the same everywhere in its range. */
  readonly constantSpacing?: Rational | undefined;
  /**
   * binary64 only: true below 2^-1022, where the exponent has bottomed out and
   * the significand absorbs the shrinking alone. The lens says "spacing grows
   * with magnitude" everywhere else, and that sentence is false here.
   */
  readonly subnormal?: boolean | undefined;
  readonly samples: readonly LatticeSample[];
  /** Raw register contents, where the machine has one. */
  readonly raw?: string | undefined;
  readonly note?: string | undefined;
}

/* -------------------------------------------------------------------------- */
/* Fixed-point and integer machines: constant spacing                          */
/* -------------------------------------------------------------------------- */

function constantSpacingReport(
  id: string,
  label: string,
  requested: Rational,
  spacing: Rational,
  nearest: Rational | undefined,
  radius: number,
  raw: string | undefined,
  note: string,
): LatticeReport {
  if (nearest === undefined) {
    return { id, label, requested, asymmetric: false, constantSpacing: spacing, samples: [], note };
  }

  const samples: LatticeSample[] = [];
  for (let index = -radius; index <= radius; index += 1) {
    samples.push({ index, value: add(nearest, mul(spacing, rational(BigInt(index)))) });
  }

  return {
    id,
    label,
    requested,
    nearest,
    quantizationError: sub(nearest, requested),
    // The point of a fixed-point grid: both neighbours are the same distance,
    // here and everywhere else in range.
    gapBelow: spacing,
    gapAbove: spacing,
    asymmetric: false,
    constantSpacing: spacing,
    samples,
    ...(raw === undefined ? {} : { raw }),
    note,
  };
}

export function q128LatticeReport(
  config: Q128_128Config,
  meters: Rational,
  radius = 4,
): LatticeReport {
  const write = encodeQ128(config, meters);
  const nearest =
    write.decodedMeters ??
    (write.state === undefined ? undefined : decodeMeters(config, write.state));

  return constantSpacingReport(
    `q128.128@${config.baseUnitLabel}`,
    `Q128.128 @ ${config.baseUnitLabel}`,
    meters,
    physicalLsbMeters(config),
    nearest,
    radius,
    write.state === undefined ? undefined : rawHex(write.state),
    write.status === 'rejected'
      ? 'Out of range for this machine.'
      : 'Constant spacing everywhere in range.',
  );
}

export function planckLatticeReport(
  meters: Rational,
  radius = 4,
  config: PlanckConfig = DEFAULT_PLANCK_CONFIG,
): LatticeReport {
  const write = encodePlanck(meters, config);
  return constantSpacingReport(
    'planck-int256',
    'Planck grid (256-bit)',
    meters,
    config.constants.planckLength.nominal,
    write.decoded,
    radius,
    write.state === undefined ? undefined : `${write.state.ticks.toString(10)} ticks`,
    write.status === 'rejected'
      ? 'Out of range for this machine.'
      : `One tick is one nominal Planck length (${config.constants.planckLength.source} ${config.constants.planckLength.sourceVersion}).`,
  );
}

/* -------------------------------------------------------------------------- */
/* binary64: spacing that grows with magnitude                                 */
/* -------------------------------------------------------------------------- */

export function binary64LatticeReport(meters: Rational, radius = 4): LatticeReport {
  const encoded = encodeRational(meters);
  if (!isFiniteState(encoded.state)) {
    return {
      id: 'binary64',
      label: 'binary64',
      requested: meters,
      asymmetric: false,
      samples: [],
      note: `Not finite in binary64 — it encodes as ${encoded.state.kind}.`,
    };
  }

  const centre = encoded.state.value;
  const { gapBelow, gapAbove } = neighbors(centre);

  const samples: LatticeSample[] = [{ index: 0, value: encoded.state.exact }];
  let below = centre;
  let above = centre;
  for (let step = 1; step <= radius; step += 1) {
    below = predecessor(below);
    above = successor(above);
    const belowExact = exactValue(below);
    const aboveExact = exactValue(above);
    if (belowExact !== undefined) samples.unshift({ index: -step, value: belowExact });
    if (aboveExact !== undefined) samples.push({ index: step, value: aboveExact });
  }

  const asymmetric =
    gapBelow !== undefined && gapAbove !== undefined && !equals(gapBelow, gapAbove);

  // Below 2^-1022 the exponent has bottomed out, so the significand shrinks on
  // its own and every value is a multiple of one fixed quantum. binary64 is a
  // fixed-point machine down here, and the lens must not keep saying otherwise.
  const { isSubnormal } = fields(centre);
  const atSmallestNormal = !isSubnormal && equals(encoded.state.exact, pow2(-1022));
  const quantum = pow2(MIN_SUBNORMAL_EXPONENT);

  return {
    id: 'binary64',
    label: 'binary64',
    requested: meters,
    nearest: encoded.state.exact,
    quantizationError: sub(encoded.state.exact, meters),
    gapBelow,
    gapAbove,
    asymmetric,
    subnormal: isSubnormal,
    ...(isSubnormal ? { constantSpacing: quantum } : {}),
    samples,
    raw: `0x${bitsOf(centre).toString(16).padStart(16, '0')}`,
    note: isSubnormal
      ? 'This is the subnormal range. The exponent has bottomed out, so the spacing stops ' +
        'shrinking: every value below 2^-1022 is a multiple of 2^-1074, the same quantum all ' +
        'the way to zero. Down here binary64 is a fixed-point machine, trading its constant ' +
        'relative precision for reaching zero gradually instead of falling off it.'
      : atSmallestNormal
        ? 'The smallest normal value, and the one power-of-two boundary whose neighbours are ' +
          'the same distance away: the subnormal grid below already has this spacing. Every ' +
          'other power of two has a gap below half its gap above.'
        : asymmetric
          ? 'The neighbours are different distances away — this is a power-of-two boundary.'
          : 'Spacing grows with magnitude; there is no single constant LSB.',
  };
}

/* -------------------------------------------------------------------------- */
/* Resolution against magnitude                                                */
/* -------------------------------------------------------------------------- */

export interface ResolutionSample {
  /** log10 of the magnitude examined. */
  readonly log10Magnitude: number;
  /** log10 of the local spacing, or undefined where the machine cannot reach. */
  readonly log10Gap?: number | undefined;
}

export interface ResolutionProfile {
  readonly id: string;
  readonly label: string;
  readonly constant: boolean;
  readonly samples: readonly ResolutionSample[];
  /**
   * What the legend says about this line, when "constant" or "grows" is not
   * what this chart shows.
   *
   * `constant` is a property of the machine across every magnitude; a legend is
   * a claim about the picture under it. The subnormal inset caught the
   * difference — binary64 is drawn there precisely because it *stops* growing,
   * and the legend read "(grows)" over a line that is flat for most of its
   * width.
   */
  readonly behaviour?: string | undefined;
}

/** The local spacing a representation offers at a given magnitude. */
export function localSpacing(report: LatticeReport): Rational | undefined {
  return report.constantSpacing ?? report.gapAbove ?? report.gapBelow;
}

/**
 * How each machine's resolution behaves across the decades.
 *
 * This is the acceptance criterion in one picture: binary64's line climbs with
 * the magnitude, and a fixed-point machine's is flat. Where they cross is worth
 * seeing too — below about 10^-23 m, binary64 is the *finer* of the two.
 */
export function resolutionProfile(
  id: string,
  label: string,
  gapAt: (meters: Rational) => Rational | undefined,
  fromExponent: number,
  toExponent: number,
  constant: boolean,
): ResolutionProfile {
  const samples: ResolutionSample[] = [];
  for (let exponent = fromExponent; exponent <= toExponent; exponent += 1) {
    const magnitude = {
      numerator: 10n ** BigInt(Math.max(exponent, 0)),
      denominator: 10n ** BigInt(Math.max(-exponent, 0)),
    };
    const gap = gapAt(magnitude);
    samples.push({
      log10Magnitude: exponent,
      ...(gap === undefined || isZero(gap) ? {} : { log10Gap: log10RationalForDisplay(gap) }),
    });
  }
  return { id, label, constant, samples };
}

/**
 * The domain of the subnormal inset, straddling the smallest normal.
 *
 * 2^-1022 is about 10^-307.65, so this puts the knee a little past the middle:
 * flat to the left of it, climbing to the right. Both halves have to be in the
 * picture or the inset shows a straight line and says "here is where it bends".
 * A mutant that narrowed this to the flat side alone survived every text
 * assertion, which is why the shape is now a property with a test rather than a
 * pair of numbers at a call site.
 */
export const SUBNORMAL_INSET_DOMAIN = { from: -325, to: -295 } as const;

/** The profiles the microscope charts by default. */
export function defaultProfiles(
  preset: Q128_128PresetName,
  fromExponent = -40,
  toExponent = 30,
): ResolutionProfile[] {
  const config = Q128_128_PRESETS[preset];
  return [
    resolutionProfile(
      'binary64',
      'binary64',
      (meters) => localSpacing(binary64LatticeReport(meters, 0)),
      fromExponent,
      toExponent,
      false,
    ),
    resolutionProfile(
      `q128.128@${config.baseUnitLabel}`,
      `Q128.128 @ ${config.baseUnitLabel}`,
      () => physicalLsbMeters(config),
      fromExponent,
      toExponent,
      true,
    ),
    resolutionProfile(
      'planck-int256',
      'Planck grid',
      () => DEFAULT_PLANCK_CONFIG.constants.planckLength.nominal,
      fromExponent,
      toExponent,
      true,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Range and resolution, per base unit                                         */
/* -------------------------------------------------------------------------- */

export interface BaseUnitSummary {
  readonly preset: Q128_128PresetName;
  readonly label: string;
  readonly widthBits: number;
  readonly lsbMeters: Rational;
  readonly maxMeters: Rational;
  /** Whether the reference magnitude is exactly representable here. */
  readonly exact: boolean;
  readonly quantizationError?: Rational | undefined;
  readonly outOfRange: boolean;
}

/** The data behind "Same 256 bits. Pick your ruler." */
/* -------------------------------------------------------------------------- */
/* The two curated comparisons CLAUDE.md asks for by name                      */
/* -------------------------------------------------------------------------- */

export interface RepresentabilityRow {
  readonly label: string;
  readonly meters: Rational;
  readonly exact: boolean;
  readonly quantizationError?: Rational | undefined;
}

/**
 * CLAUDE.md required experiment 7: one Q128.128 machine, five values.
 *
 * The lesson is only visible side by side. A half is exact because two is the
 * base; a tenth never is, at any binary scale, however many bits you spend. The
 * Microscope can already show each of these one at a time, and asking a reader
 * to type five values and hold the answers in their head is not the same thing
 * as showing them the pattern.
 */
export function representabilityAtBaseUnit(
  config: Q128_128Config = DEFAULT_Q128_128_CONFIG,
): RepresentabilityRow[] {
  const values: { label: string; meters: Rational }[] = [
    { label: '1 m', meters: ONE },
    { label: '1/2 m', meters: rational(1n, 2n) },
    { label: '1 mm', meters: pow10(-3) },
    { label: '1 cm', meters: rational(1n, 100n) },
    { label: '0.1 m', meters: rational(1n, 10n) },
  ];

  return values.map(({ label, meters }) => {
    const write = encodeQ128(config, meters);
    const error = write.quantizationErrorMeters;
    return {
      label,
      meters,
      exact: error !== undefined && isZero(error),
      ...(error === undefined ? {} : { quantizationError: error }),
    };
  });
}

export interface GapRow {
  readonly label: string;
  readonly meters: Rational;
  readonly gapBelow?: Rational | undefined;
  readonly gapAbove?: Rational | undefined;
  /** True where the two differ — a power-of-two boundary. */
  readonly asymmetric: boolean;
}

/**
 * CLAUDE.md required experiment 9: binary64 neighbour gaps at 0, 1 m, 1e6 m and
 * 1e20 m.
 *
 * Twenty decades of magnitude buy twenty decades of coarseness, and the four
 * rows say so in a way no single reading does: at zero the neighbours are
 * 5 × 10^-324 m away, and at 1e20 m they are 16 kilometres away.
 */
export function gapsAcrossMagnitudes(): GapRow[] {
  const points: { label: string; meters: Rational }[] = [
    { label: '0', meters: ZERO },
    { label: '1 m', meters: ONE },
    { label: '1e6 m', meters: pow10(6) },
    { label: '1e20 m', meters: pow10(20) },
  ];

  return points.map(({ label, meters }) => {
    const encoded = encodeRational(meters);
    if (!isFiniteState(encoded.state)) {
      return { label, meters, asymmetric: false };
    }
    const { gapBelow, gapAbove } = neighbors(encoded.state.value);
    return {
      label,
      meters,
      ...(gapBelow === undefined ? {} : { gapBelow }),
      ...(gapAbove === undefined ? {} : { gapAbove }),
      asymmetric: gapBelow !== undefined && gapAbove !== undefined && !equals(gapBelow, gapAbove),
    };
  });
}

export function baseUnitSummaries(meters: Rational): BaseUnitSummary[] {
  return (Object.keys(Q128_128_PRESETS) as Q128_128PresetName[]).map((preset) => {
    const config = Q128_128_PRESETS[preset];
    const write = encodeQ128(config, meters);
    const error = write.quantizationErrorMeters;
    return {
      preset,
      label: config.baseUnitLabel,
      widthBits: Q128_128.widthBits,
      lsbMeters: physicalLsbMeters(config),
      maxMeters: mul(
        { numerator: (1n << 255n) - 1n, denominator: 1n << 128n },
        config.baseUnitMeters,
      ),
      exact: error !== undefined && isZero(error),
      quantizationError: error,
      outOfRange: write.status === 'rejected',
    };
  });
}

/** Convenience: the magnitude of an error, for sorting and display. */
export function errorMagnitude(report: LatticeReport): Rational {
  return report.quantizationError === undefined ? ZERO : abs(report.quantizationError);
}
