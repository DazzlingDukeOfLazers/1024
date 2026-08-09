# Task Backlog

Claude Code: work top-to-bottom unless a dependency requires otherwise. Mark completed items `[x]` and add discovered work beneath the relevant section.

## Bootstrap

- [x] Initialize Vite + React + TypeScript project.
- [x] Enable strict TypeScript.
- [x] Add Vitest.
- [x] Add Playwright.
- [x] Add typecheck/build/test scripts.
- [x] Create package/module directories from `CLAUDE.md`.
- [x] Add a minimal app shell with navigation between placeholder lenses.
- [x] Add ESLint + Prettier. Design docs and fixtures are Prettier-ignored so the
      specification is never reflowed.
- [ ] Add CI (no runner chosen yet).

## Exact math

- [x] Implement normalized `Rational`.
- [x] Implement exact comparison.
- [x] Implement powers of 2 and 10 helpers.
- [x] Implement exact-safe Rational order-of-magnitude / display log10 helper.
- [x] Implement rational JSON encoding/decoding.
- [x] Add property/unit tests.
- [x] Implement `Quantity<Dimension>` wrapper.
- [x] Implement exact SI length prefixes.
- [x] Implement engineering notation formatter.

Discovered while implementing:

- [x] Exact decimal-literal parser (`parseDecimalExact`) so user input never
      routes through `Number`. Also a `"3/7"` fraction form for fixtures/share state.
- [x] Named rounding modes on `Rational` (`nearest-even`/`truncate`/`floor`/`ceil`).
      Milestone 2 quantization needs these and they belong to the exact core.
- [x] `toExactDecimalString`, which returns `undefined` for repeating expansions
      rather than silently truncating.
- [x] `toNumberForDisplay`, a saturating rational → double conversion for bounded
      display use only.
- [ ] Time units beyond SI prefixes are currently min/h/d/Julian year. Astronomical
      length units (AU, light-year, parsec) need declared constants with provenance —
      deferred to the Planck/constants work rather than hard-coded into `units.ts`.
- [ ] `orderOfMagnitude10` corrects a bit-length estimate by exact comparison in a
      loop. Fine at present scales; revisit if profiling shows it matters.

## Finite registers

- [ ] Implement signed width limits.
- [ ] Implement two's-complement wrapping.
- [ ] Implement checked overflow event type.
- [ ] Implement generic binary fixed-point helper.
- [ ] Implement configurable-base-unit Q128.128 (`@mm`, `@m`, `@km` presets).
- [ ] Keep machine base unit separate from display unit.
- [ ] Implement Q512.512 finite error accumulator.
- [ ] Define per-representation ErrorLedger.
- [ ] Add exact/inexact/base-unit/overflow tests.

## Planck representation

- [ ] Add declared Planck nominal constant metadata/provenance/uncertainty structure.
- [ ] Keep physical constant uncertainty separate from numerical error.
- [ ] Implement 256-bit Planck tick register.
- [ ] Implement SI ↔ Planck quantization.
- [ ] Keep physical-model disclaimer in UI.

## Binary64

- [ ] Decode `number` bits using `DataView`.
- [ ] Convert finite binary64 exactly to `Rational`.
- [ ] Expose sign/exponent/fraction.
- [ ] Implement predecessor/successor.
- [ ] Implement predecessor/successor with `gapBelow` and `gapAbove`.
- [ ] Preserve +0/-0 and finite/Infinity/NaN states.
- [ ] Add known-pattern and powers-of-two gap tests.

## Experiments

- [ ] Define immutable `ExperimentStep`.
- [ ] Define per-representation machine interface.
- [ ] Build experiment runner.
- [ ] Track operand encoding vs operation rounding/quantization error per representation.
- [ ] Track current divergence and cumulative absolute diagnostics by category.
- [ ] Feed per-representation error events into its Q512.512 accumulator.
- [ ] Implement first-class compact `repeat` with checkpoint trace policy.
- [ ] Add chunk/progress callback API; keep runner worker-ready.
- [ ] Serialize/restore compact experiment traces.
- [ ] Add built-in experiment fixtures.
- [ ] Add floating-origin/rebasing experiment.

## Catalog

- [ ] Define runtime schema and validation.
- [ ] Load sample fixtures.
- [ ] Add 20–30 initial objects.
- [ ] Preserve representative range/approximation labels.
- [ ] Keep visuals optional.

## Comparator

- [ ] Object search/select.
- [ ] Ratio.
- [ ] End-to-end count.
- [ ] Arbitrary multiplier (`123 × coconut`).
- [ ] Exact vs approximate wording.
- [ ] Simple SVG visual result.

## Ruler

- [ ] Implement camera model.
- [ ] Implement physical-to-screen transform using exact origin subtraction before Number conversion.
- [ ] Add `1e20 m` origin + `1 mm` separation rendering regression.
- [ ] Implement 1/2/5 grid-step chooser.
- [ ] Engineering-prefix grid labels.
- [ ] Pan.
- [ ] Wheel/pinch zoom.
- [ ] LOD thresholds.
- [ ] RBC end-to-end demo.

## Atlas

- [ ] Implement exact-safe Rational log10 positioning (no full Rational → Number coercion).
- [ ] Add decade/prefix axis.
- [ ] Render object markers.
- [ ] Declutter overlapping labels.
- [ ] Selection.
- [ ] Jump Atlas → Ruler.

## Representation Lab

- [ ] Render representation rows.
- [ ] Step runner controls.
- [ ] Error metrics.
- [ ] Raw-bit inspection.
- [ ] Implement Zoom to Disagreement.
- [ ] Display magnification disclosure.
- [ ] Add "Abuse the Computer" presets.
- [ ] Add floating-origin/rebasing preset showing absolute vs local coordinates.

## Numerical Microscope

- [ ] Q128.128 adjacent-value lattice at selectable machine base units.
- [ ] Add "Same 256 bits. Pick your ruler." range/LSB panel.
- [ ] binary64 adjacent-value lattice with asymmetric gaps.
- [ ] magnitude slider/input.
- [ ] visual local resolution comparison.
- [ ] exact stored-value inspector.

## Share state

- [ ] Define versioned backend-free share URL schema.
- [ ] Encode exact Rational/BigInt state losslessly.
- [ ] Include lens, selection/experiment, representation config, camera, and relevant display state.
- [ ] Add Share this view action and round-trip test.

## Hardening

- [ ] Playwright critical path.
- [ ] accessibility pass.
- [ ] performance profiling.
- [ ] visual regression after layout stabilizes.
- [ ] documentation refresh.
