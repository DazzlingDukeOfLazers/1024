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

- [x] Implement signed width limits.
- [x] Implement two's-complement wrapping.
- [x] Implement checked overflow event type.
- [x] Implement generic binary fixed-point helper.
- [x] Implement configurable-base-unit Q128.128 (`@mm`, `@m`, `@km` presets).
- [x] Keep machine base unit separate from display unit.
- [x] Implement Q512.512 finite error accumulator.
- [x] Define per-representation ErrorLedger.
- [x] Add exact/inexact/base-unit/overflow tests.

Discovered while implementing:

- [x] `storeSigned` is the only way a value enters a simulated register, and a
      refused checked write carries no value at all — a caller cannot use one by
      accident.
- [x] The error meters saturate by default rather than refusing. A refused write
      silently drops a contribution; a pinned reading plus an event is honest.
      `docs/NUMERICS.md` §6 updated.
- [x] `cumulativeSignedIntroducedError` added to the ErrorLedger: the exact
      counterpart of the signed Q512.512 meter, so the meter's own quantization is
      measurable rather than assumed. `docs/NUMERICS.md` §6 updated.
- [x] Four-register spacetime frames (`spacetime.ts`) with exact `ct` conversion.
- [ ] `ErrorContribution` is currently produced by hand. The experiment runner
      (milestone 4) must compute the §7 decomposition and assert
      `decompositionResidual` is zero on every step.
- [ ] Only addition is implemented on the finite machines. Subtraction, multiply
      and divide arrive with the experiment step types in milestone 4.

## Planck representation

- [x] Add declared Planck nominal constant metadata/provenance/uncertainty structure.
- [x] Keep physical constant uncertainty separate from numerical error.
- [x] Implement 256-bit Planck tick register.
- [x] Implement SI ↔ Planck quantization.
- [x] Keep physical-model disclaimer in UI.
- [ ] Constants are frozen as `CODATA_2018`. Adding a second set (a later CODATA,
      or a deliberately different nominal) would demonstrate that quantization is
      conditioned on the declaration — worth doing once experiments are versioned.

## Binary64

- [x] Decode `number` bits using `DataView`.
- [x] Convert finite binary64 exactly to `Rational`.
- [x] Expose sign/exponent/fraction.
- [x] Implement predecessor/successor.
- [x] Implement predecessor/successor with `gapBelow` and `gapAbove`.
- [x] Preserve +0/-0 and finite/Infinity/NaN states.
- [x] Add known-pattern and powers-of-two gap tests.

Discovered while implementing:

- [x] `encodeRational` rounds an exact rational to binary64 itself, nearest-even,
      rather than delegating to `Number(string)`. Values with no decimal literal
      (1/3) must go through the same path as ones that have one, and the encoder
      must report overflow to Infinity and underflow to a signed zero as states
      rather than as silently wrong numbers. Tested against the language's own
      rounding across a spread of literals.
- [x] `orderOfMagnitude2` added beside `orderOfMagnitude10` — exact floor(log2)
      on a rational, which the encoder needs to pick a quantum before it may
      touch a `number`.
- [x] `errorInLocalGaps` expresses error as a fraction of a *named* gap
      (`docs/NUMERICS.md` §10) instead of one ambiguous ULP figure.
- [x] `addRational` on binary64, so the machine matches the shape of the fixed
      point ones. Unlike fixed point its operation rounding error is routinely
      non-zero, which is the whole lesson.
- [ ] NaN payload bits are read from the pattern but not asserted to survive a
      round trip through a JS `number`. Engines may canonicalize non-standard NaN
      payloads; the tests deliberately do not depend on it.
- [ ] `binary64.ts` uses one module-level 8-byte `DataView` as a conversion
      scratch. It carries nothing between calls, but if the runner ever moves to
      a Worker, confirm that assumption still holds.

## Experiments

- [x] Define immutable `ExperimentStep`.
- [x] Define per-representation machine interface.
- [x] Build experiment runner.
- [x] Track operand encoding vs operation rounding/quantization error per representation.
- [x] Track current divergence and cumulative absolute diagnostics by category.
- [x] Feed per-representation error events into its Q512.512 accumulator.
- [x] Implement first-class compact `repeat` with checkpoint trace policy.
- [x] Add chunk/progress callback API; keep runner worker-ready.
- [x] Serialize/restore compact experiment traces.
- [x] Add built-in experiment fixtures.
- [x] Add floating-origin/rebasing experiment.

Discovered while implementing:

- [x] Measured before designing. A naive million-step run costs ~76 s, of which
      ~20 s per machine is ledger updates and ~7 s is re-quantizing a constant
      operand. Two changes bring it to ~1.5 s without weakening any guarantee:
      `RepeatPlan` hoists operand encoding so each iteration is one integer add,
      and long repeats account per checkpoint interval.
- [x] Interval accounting is *exactly equal* to per-iteration accounting for
      `add`/`sub` — proven by the identity in the runner and asserted by a test
      that runs both modes and compares ledgers. It is refused for every other
      op. The one figure it cannot reproduce is the cumulative *absolute*
      rounding total on machines whose operations round, since errors that
      cancelled inside an interval are not recoverable from its endpoints; that
      case sets `absoluteRoundingIsLowerBound` and the UI says so.
- [x] `decompositionResidual` is asserted on every accounted step; the runner
      throws rather than recording a decomposition that does not balance.
- [ ] Only `set`/`add`/`sub`/`mul`/`div` exist. Repeated rotations, velocity
      integration and subtraction of nearly equal numbers (PROJECT_SPEC §7) need
      more ops and probably a vector state.
- [ ] The runner is Worker-ready — pure, chunked, with a plain `{aborted}` signal
      — but still runs on the main thread. Move it when the Lab UI lands.
- [ ] `mul`/`div` on the fixed-point machines apply an exact scalar and
      requantize, so all their error is operation rounding. If a future
      experiment needs the scalar itself held in a register, that becomes
      operand encoding and the adapter must change.

## Catalog

- [x] Define runtime schema and validation.
- [x] Load sample fixtures.
- [x] Add 20–30 initial objects.
- [x] Preserve representative range/approximation labels.
- [x] Keep visuals optional.

Discovered while implementing:

- [x] The loader accepts values as strings as well as `{numerator, denominator}`,
      and fixtures declare a natural unit. `docs/DATA_MODEL.md` updated.
- [x] `au` and `ly` added to the unit registry — both are exactly defined, so
      they are conversions rather than catalog measurements.
- [ ] **22 of the 24 objects carry `source: "demonstration value"`.** They are
      curated and plausible, not sourced. Replacing them is a data task; the
      schema, ranges and exact/approximate wording already work. A test asserts
      nothing outside the two definitions claims to be exact.
- [ ] Only one length per object. A second length (a human's width, say) needs an
      explicit `primary` field rather than `primaryLength`'s current "the one
      length there is".
- [ ] `relations` is validated but empty. Progressive semantic detail
      (milestone 11) is what will fill it.

## Comparator

- [x] Object search/select.
- [x] Ratio.
- [x] End-to-end count.
- [x] Arbitrary multiplier (`123 × coconut`).
- [x] Exact vs approximate wording.
- [x] Simple SVG visual result.

Discovered while implementing:

- [x] Ranges propagate through every operation, inverting where they should:
      a *larger* red blood cell means *fewer* fit across a millimetre.
- [x] `wholeItemsToSpan` answers the question you would actually ask when laying
      objects out — 134 cells, not 133.3.
- [x] The strip renderer collapses to an aggregate when items fall below a pixel,
      and says so. The count never changes; only the drawing does.
- [ ] Search is a substring scan over 24 objects. Fine now; it needs an index
      long before the catalog is large.
- [ ] The comparator is length-only in practice. Area and volume need real
      geometry, not a reused length ratio (`docs/DATA_MODEL.md`).

## Ruler

- [x] Implement camera model.
- [x] Implement physical-to-screen transform using exact origin subtraction before Number conversion.
- [x] Add `1e20 m` origin + `1 mm` separation rendering regression.
- [x] Implement 1/2/5 grid-step chooser.
- [x] Engineering-prefix grid labels.
- [x] Pan.
- [x] Wheel zoom.
- [x] LOD thresholds.
- [x] RBC end-to-end demo.

Discovered while implementing:

- [x] The zoom exponent is a double, per `docs/UI_SPEC.md`, but the geometry must
      still be exact with respect to it. `metersPerPixel` splits the exponent
      into a decade and a bounded mantissa and takes the mantissa's *exact*
      binary64 value, so nothing is approximated twice.
- [x] Panning and zooming are exactly reversible. Five hundred pans out and back
      return to the identical centre, and two hundred wheel events leave the
      anchor exactly where it started — asserted by tests, and true because the
      centre is a rational rather than a float.
- [x] Two real browser bugs the Playwright tests caught, neither visible to the
      unit tests: `currentTarget` was read lazily inside a `setCamera` updater
      (React has nulled it by then, so zooming crashed the lens), and React 19
      attaches wheel listeners passively, so `preventDefault` in an `onWheel`
      prop silently did nothing. The wheel handler is now a non-passive listener
      attached by effect.
- [x] Manual `useMemo`/`useCallback` removed from the ruler: the React Compiler
      lint could not preserve it, and the computations are cheap.
- [ ] Pinch zoom is not implemented — only wheel. It needs pointer-event
      bookkeeping for two touches.
- [ ] The viewport is a fixed 960×260 SVG viewBox scaled by CSS rather than a
      measured element. Fine for now; the atlas will want a real resize
      observer.
- [ ] The ruler is one-dimensional. A vertical axis needs the same camera
      applied twice, not a second camera model.

## Atlas

- [x] Implement exact-safe Rational log10 positioning (no full Rational → Number coercion).
- [x] Add decade/prefix axis.
- [x] Render object markers.
- [x] Declutter overlapping labels.
- [x] Selection.
- [x] Jump Atlas → Ruler.

Discovered while implementing:

- [x] Markers and labels declutter separately. Markers merge into clusters that
      report every member — nothing is dropped, and the object count is
      displayed. Labels collide far sooner because text is wide, so they stagger
      across three rows and are only withheld when even staggering fails. A
      withheld label is not a hidden object.
- [x] Selection lives in the app shell rather than in a lens, which is what makes
      it survive the Atlas → Ruler jump. The Ruler is keyed on the selection so
      choosing an object re-frames the camera without an effect chasing a prop,
      and the Comparator takes it as subject A.
- [x] The landing lens is now the Atlas. Nine e2e tests that assumed the Lab was
      on screen navigate there explicitly.
- [ ] Cluster membership is anchored at the first member, so which object
      represents a cluster can change as you pan. Fine at 24 objects; a stable
      representative (largest? nearest the centroid?) would be better at 500.
- [ ] Progressive semantic detail (milestone 11) is the missing half of the
      Atlas: zooming should reveal *related* objects, not just closer ones.
- [ ] No keyboard navigation for selection yet — the markers are pointer-only.

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
