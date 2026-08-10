/**
 * Colour-vision simulation, for checking the palette against something other
 * than my own eyes.
 *
 * The matrices are the Viénot–Brettel–Mollon (1999) linear-RGB dichromacy
 * approximations, which is what browser devtools and most simulators use. Two
 * honest caveats, stated here rather than discovered later:
 *
 *  - a simulation is a model of dichromacy, not a person's experience, and
 *    anomalous trichromacy (the common case) is a spectrum this does not
 *    represent at all;
 *  - passing it means the palette survives a *model*. It is evidence, not a
 *    substitute for asking someone.
 *
 * What it is genuinely good for is the thing axe cannot check: axe measures
 * contrast as rendered, and says nothing about whether two colours that mean
 * different things stay different when the red-green axis collapses.
 */

export type ColourVision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHex(hex: string): Rgb {
  const text = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(text)) throw new Error(`not a six-digit hex colour: ${hex}`);
  return {
    r: Number.parseInt(text.slice(0, 2), 16) / 255,
    g: Number.parseInt(text.slice(2, 4), 16) / 255,
    b: Number.parseInt(text.slice(4, 6), 16) / 255,
  };
}

/** sRGB companding, both directions — the simulation is linear-light. */
const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const toSrgb = (channel: number): number => {
  const clamped = Math.min(Math.max(channel, 0), 1);
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const MATRICES: Record<Exclude<ColourVision, 'normal'>, Matrix> = {
  protanopia: [
    [0.11238, 0.88762, 0.0],
    [0.11238, 0.88762, 0.0],
    [0.00401, -0.00401, 1.0],
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0.0],
    [0.29275, 0.70725, 0.0],
    [-0.02234, 0.02234, 1.0],
  ],
  tritanopia: [
    [1.0, 0.14461, -0.14461],
    [0.0, 1.0, 0.0],
    [0.0, 0.85373, 0.14627],
  ],
};

export function simulate(colour: Rgb, vision: ColourVision): Rgb {
  if (vision === 'normal') return colour;
  const m = MATRICES[vision];
  const [r, g, b] = [toLinear(colour.r), toLinear(colour.g), toLinear(colour.b)];
  return {
    r: toSrgb(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    g: toSrgb(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    b: toSrgb(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  };
}

/** WCAG 2 relative luminance. */
export function luminance(colour: Rgb): number {
  return 0.2126 * toLinear(colour.r) + 0.7152 * toLinear(colour.g) + 0.0722 * toLinear(colour.b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * How far apart two colours are, as a fraction of the largest possible
 * separation. Euclidean in sRGB is a crude perceptual measure and is used here
 * only for what it is good at: catching a pair that has collapsed to *the same
 * colour*, which is unambiguous in any metric.
 */
export function separation(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}
