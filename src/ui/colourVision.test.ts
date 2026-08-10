import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ColourVision,
  type Rgb,
  contrast,
  luminance,
  parseHex,
  separation,
  simulate,
} from './colourVision';

/**
 * The palette, read from the stylesheet rather than copied into this file.
 *
 * A copy would let the two drift, and a colour test that passes against last
 * month's palette is worse than none — it reports on a design nobody is
 * shipping.
 */
const PALETTE: Record<string, string> = (() => {
  const css = readFileSync(fileURLToPath(new URL('./app.css', import.meta.url)), 'utf-8');
  const found: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6});/g)) {
    found[match[1]!] = match[2]!;
  }
  return found;
})();

const VISIONS: ColourVision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

const seen = (name: string, vision: ColourVision): Rgb => {
  const hex = PALETTE[name];
  if (hex === undefined) throw new Error(`--${name} is no longer in app.css`);
  return simulate(parseHex(hex), vision);
};

describe('the simulation itself', () => {
  // Everything below is measured *through* `simulate`. If it returned its
  // argument, every contrast assertion would pass while checking nothing —
  // the exact shape of vacuity this project keeps finding, so it is closed
  // first and explicitly.
  it('actually moves colours', () => {
    const teal = parseHex(PALETTE['accent']!);
    for (const vision of VISIONS.filter((v) => v !== 'normal')) {
      expect(separation(teal, simulate(teal, vision)), vision).toBeGreaterThan(0.02);
    }
    expect(separation(teal, simulate(teal, 'normal'))).toBe(0);
  });

  it('leaves greys where they are, which is the sanity check on the matrices', () => {
    // A dichromat sees achromatic colours as achromatic. A simulation that
    // tints grey has its matrices wrong or its companding backwards.
    for (const vision of VISIONS) {
      for (const grey of ['#000000', '#808080', '#ffffff']) {
        const simulated = simulate(parseHex(grey), vision);
        expect(separation(parseHex(grey), simulated), `${grey} under ${vision}`).toBeLessThan(0.02);
      }
    }
  });

  it('agrees with the WCAG worked examples on contrast', () => {
    // Black on white is 21:1 and a colour against itself is 1:1, by definition.
    expect(contrast(parseHex('#000000'), parseHex('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrast(parseHex('#7fd1c1'), parseHex('#7fd1c1'))).toBeCloseTo(1, 10);
    expect(luminance(parseHex('#ffffff'))).toBeCloseTo(1, 10);
    expect(luminance(parseHex('#000000'))).toBeCloseTo(0, 10);

    // The primaries, which is the part that actually pins the coefficients.
    // Everything above is invariant under swapping them — the coefficients sum
    // to one, so white stays 1 and black stays 0 whatever order they are in,
    // and a mutant that swapped R and G survived this test until these three
    // lines existed.
    expect(luminance(parseHex('#ff0000'))).toBeCloseTo(0.2126, 6);
    expect(luminance(parseHex('#00ff00'))).toBeCloseTo(0.7152, 6);
    expect(luminance(parseHex('#0000ff'))).toBeCloseTo(0.0722, 6);
  });
});

describe('the palette survives a colour-vision simulation', () => {
  // axe checks contrast as rendered and says nothing about what happens when
  // the red-green axis collapses. This is that check.
  const AGAINST_PANEL = ['accent', 'warn', 'muted'];

  it('keeps every text colour above the AA contrast floor', () => {
    // Measured floor across all four visions is 6.50 (muted on panel), so 4.5
    // is asserted with real headroom rather than as a coincidence.
    for (const vision of VISIONS) {
      for (const name of AGAINST_PANEL) {
        expect(
          contrast(seen(name, vision), seen('panel', vision)),
          `${name} on panel, ${vision}`,
        ).toBeGreaterThan(4.5);
      }
      expect(
        contrast(seen('text', vision), seen('bg', vision)),
        `text on bg, ${vision}`,
      ).toBeGreaterThan(4.5);
    }
  });

  it('never collapses the two colours that carry different meanings', () => {
    // `--accent` marks exact, `--warn` marks rounded. Under every simulation
    // they must stay visibly different colours. Measured: 0.328 apart normally,
    // dropping to 0.238 under protanopia — compressed, as expected when the
    // red-green axis goes, but nowhere near collapsed.
    for (const vision of VISIONS) {
      expect(separation(seen('accent', vision), seen('warn', vision)), vision).toBeGreaterThan(
        0.15,
      );
    }
  });

  it('is not relying on that separation anyway', () => {
    // The stronger guarantee, and the one WCAG 1.4.1 actually asks for: colour
    // is never the only channel. `ExactnessTag` writes the words "exact" and
    // "rounded", so the distinction survives a simulation this file cannot
    // model — including a monochrome display or a printout.
    const tag = readFileSync(
      fileURLToPath(new URL('./ExactnessTag.tsx', import.meta.url)),
      'utf-8',
    );
    expect(tag).toContain("'exact'");
    expect(tag).toContain("'rounded'");
  });
});
