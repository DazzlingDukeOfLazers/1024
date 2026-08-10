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
- [x] Add CI. GitHub Actions runs typecheck, lint, format, unit tests, build and
      Playwright on every push. `npm ci` honours the committed `allowScripts`
      block, which is what lets esbuild build itself on a clean machine.

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
- [x] `ErrorContribution` is computed by the runner, not by hand, and every
      step asserts `decompositionResidual` is zero — a decomposition bug
      throws rather than being absorbed into a bucket.
- [x] `set`, `add`, `sub`, `mul` and `div` are implemented on every finite
      machine. `mul` is what `(1/10) × 10` needs, which CLAUDE.md lists as a
      required initial experiment.

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
- [x] Moved into a Web Worker. The runner itself needed **no changes** — the
      "worker-ready" claim held. A million steps is now a progress count rather
      than a frozen tab, and an e2e test proves it by clicking the nav mid-run.
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
- [x] **Four objects claimed `approximation: "measured"` while carrying
      `source: "demonstration value"`.** A measurement with no citation is not a
      measurement, and the schema permitted the contradiction. It now rejects it:
      `exact` and `measured` require a source, and a provenance status written
      into the source field is refused outright. The proton, Moon, Earth and Sun
      are cited (CODATA 2018, NASA, WGS 84, IAU 2015 B3), as is the hydrogen
      atom's derivation from the Bohr radius. The other 19 dropped the
      placeholder: `representative` and `estimated` claim nothing checkable, so
      an absent source is the honest way to say so.
- [x] **The Atlas showed a curated number with no indication of what backed it.**
      A red blood cell read `7.5 µm`, in the same type as an exactly defined
      astronomical unit, which is precisely what the `approximation` field exists
      to prevent. The selection panel now carries the range and a "Where it comes
      from" row.
- [x] **All three lenses that show a curated number, not just the Atlas.** The
      Comparator had the same defect in a subtler form — it rendered the source
      when there was one and nothing when there was not, so the 21 uncited
      objects passed silently. The Ruler draws objects to scale, a strong claim
      about a number the reader did not choose, and named no source at all. Both
      now render `provenanceSummary`, and an end-to-end test walks the same red
      blood cell through all three so they cannot drift apart.
      `provenanceSummary` takes the two fields it needs rather than a
      `CatalogQuantity`, so a comparator subject built from a unit literal gets
      the same sentence from the same code — and says "Exactly defined." with no
      caveat, because a millimetre is a definition, not a plausible round number.
- [x] **"Source the remaining 19 objects" was the wrong task**, and the version
      of it that was right — "cite the four or five that are citable" — is done.
      The research answered it more sharply than expected: **two** are citable,
      not four or five, and finding that out was the work.

      - **DNA double helix.** Arnott & Hukins 1972, optimised B-DNA
        fibre-diffraction parameters; 20.4 Å as recorded by BioNumbers BNID
        105243. Kept `representative` at 2 nm rather than promoted to
        `measured`: a helix has no edge any more than an atom does, the figure
        depends where the backbone surface is taken to be, and 20.4 Å is only in
        the curated database — I could not check it against the primary paper.
        The source names the convention, which is what the hydrogen atom's
        already does.
      - **Solar System.** Twice Neptune's semi-major axis, 30.07 au (NASA
        planetary fact sheet; 30.0699 au in the Princeton tables). The stored
        value was 60.2, which is not twice 30.07 — corrected to 60.14, and a
        test now derives it from the figure the source names, so the citation
        and the number cannot drift apart.

      Investigated and deliberately **not** cited:

      - **Red blood cell.** The 6.2–8.2 µm range is real but traceable only to
        secondary sources, and it is preparation-dependent — it is the interval
        for stained, dried smears, while fresh cells measure larger. Citing it
        would attach a reference to a number whose conditions the reference does
        not state.
      - **Water molecule.** 0.28 nm is convention-dependent in the same way as
        the hydrogen atom, but the conventions disagree — van der Waals against
        kinetic diameter — and I could not establish which the stored figure is.

- [ ] Only one length per object. A second length (a human's width, say) needs an
      explicit `primary` field rather than `primaryLength`'s current "the one
      length there is".
- [x] `relations` carries 20 edges across the 28 objects, which is what the
      Atlas walks. Progressive semantic detail (milestone 11) filled it.

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
- [ ] Search is a substring scan over 28 objects. Fine now; it needs an index
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
- [x] **On a phone there was no way to zoom either view at all.** Both set
      `touch-action: none`, which takes the browser's own pinch away — correct,
      because the app owns the gesture, but only if the app then implements it,
      and it did not. The wheel does not exist on a touchscreen and neither
      does the keyboard, so the two central lenses were pan-only there. The
      gesture arithmetic is in `pinch.ts`, pure and shared, so the ruler and
      the atlas cannot drift; each view keeps its own pointer bookkeeping
      because their drag semantics differ. Lifting one of two fingers hands
      the drag to the one still down rather than jumping, and lifting out of a
      pinch never reads as a tap on the Atlas.
- [ ] Rotation and two-finger panning of a vertical axis are not handled, because
      neither view has a second axis yet. When the ruler gains one, `pinch.ts`
      needs the same treatment in y rather than a second gesture model.
- [x] The viewport was a fixed 960×260 SVG viewBox scaled by CSS rather than a
      measured element, which made every figure the view stated in pixels false
      at every width but one. `useMeasuredWidth` and a `ResizeObserver` now size
      the viewBox so one unit is one CSS pixel.
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
      represents a cluster can change as you pan. Fine at 28 objects; a stable
      representative (largest? nearest the centroid?) would be better at 500.
- [ ] Progressive semantic detail (milestone 11) is the missing half of the
      Atlas: zooming should reveal *related* objects, not just closer ones.
- [x] Selection is keyboard-reachable through the object picker, and the axis
      pans and zooms from the keyboard. The markers themselves are still
      pointer-only hit targets, which is why the picker exists.

## Representation Lab

- [x] Render representation rows.
- [x] Step runner controls.
- [x] Error metrics.
- [x] Raw-bit inspection.
- [x] Implement Zoom to Disagreement.
- [x] Display magnification disclosure.
- [x] Add "Abuse the Computer" presets.
- [x] Add floating-origin/rebasing preset showing absolute vs local coordinates.

Discovered while implementing:

- [x] The magnification is computed from the two cameras actually drawn with,
      not from the intended zoom, so the disclosed figure always describes the
      picture on screen rather than an intention.
- [x] Whether the view is magnified is part of the shareable state. A link that
      dropped it would show the recipient a different claim than the sender
      made.
- [x] Two experiments added to complete CLAUDE.md's required list: `(1/10) × 10`
      and subtracting nearly equal numbers. The first is a good result —
      binary64 rounds twice and lands back on 1 exactly, while the fixed-point
      machines do not, because a tenth was never on their grid.
- [x] A machine whose divergence is many decades smaller than the widest lands
      on the same pixel as the reference even when zoomed. That is correct: at
      that zoom its error genuinely is invisible. The test asserts nothing is
      ever drawn on the *wrong* side rather than demanding strict separation.
- [x] The runner now executes in a Web Worker, with progress and cancellation.
- [ ] The timeline shows divergence per checkpoint but does not chart it.
      A sparkline per representation would show the drift accumulating.
- [ ] Zoom to Disagreement is a toggle, not a continuous zoom. The spec's
      "centre the local ruler" phrasing suggests handing the camera to the
      Ruler lens instead.

## Numerical Microscope

- [x] Q128.128 adjacent-value lattice at selectable machine base units.
- [x] Add "Same 256 bits. Pick your ruler." range/LSB panel.
- [x] binary64 adjacent-value lattice with asymmetric gaps.
- [x] magnitude input.
- [x] visual local resolution comparison.
- [x] exact stored-value inspector.

Discovered while implementing:

- [x] Each lattice is drawn at *its own* scale, and each row says what that
      scale is. A shared scale would be dishonest — Q128.128 @ m is twenty-three
      decades finer than binary64 near 1 m, so one of the two would always be an
      invisible smear.
- [x] The binary64 lattice walks real `successor`/`predecessor` neighbours rather
      than stepping by a nominal gap, so the uneven spacing at a power of two
      shows up as uneven spacing on screen. A constant-LSB approximation would
      have hidden exactly the thing the lens exists to show.
- [x] The resolution-against-magnitude chart makes the acceptance criterion one
      picture, and shows the lines *crossing*: below about 10^-23 m, binary64 is
      the finer of the two. Fixed point is not uniformly better, and the lens
      should not imply it is.
- [x] "Same 256 bits. Pick your ruler." is now one component used by both the
      Microscope and the Lab, rather than two tables that could disagree about
      what a machine can hold.
- [ ] There is no zoom control on a lattice — the radius is fixed at four
      neighbours either side. UI_SPEC mentions "zoom to adjacent representable
      values", which this satisfies statically but not interactively.
- [ ] The chart samples one point per decade. Near a power of two the binary64
      line is really a staircase, and at this resolution it reads as a straight
      line.
- [x] **The lens said something false in the subnormal range.** Below 2^-1022
      the exponent has bottomed out, the significand shrinks alone, and every
      value is a multiple of one fixed quantum — binary64 is a fixed-point
      machine down there. The note read "Spacing grows with magnitude; there
      is no single constant LSB" at 10^-310, which is the opposite of what is
      happening and the opposite of what the lens exists to teach. The gap
      arithmetic underneath was already right; only the reporting lied. There
      is now a `subnormal` flag, a Regime row naming the quantum, and a note
      per regime.
- [x] The smallest normal, 2^-1022, is called out as the one power-of-two
      boundary whose neighbours are equidistant — the subnormal grid below
      already has that spacing. Every other power of two has a gap below half
      its gap above, and the lens said so without noticing the exception.
- [ ] The resolution chart runs 10^-40 to 10^30, so the subnormal floor —
      binary64's line going flat below 10^-308 while every other machine's
      stays flat throughout — is off the left edge. Widening the domain by
      270 decades to show it would squash the part of the chart that is about
      metres. It probably wants its own inset rather than a wider axis.
- [x] Author relations in the catalog fixture.
- [x] Derive inverse relations rather than authoring both directions.
- [x] Relation path search (graph traversal, not a hard-coded tree).
- [x] Scale-sensitive related-object suggestions.
- [x] Reveal unrelated neighbours by size alone.
- [x] Graph navigation in the Atlas.

Discovered while implementing:

- [x] Four objects added (hand, finger, skin cell, water molecule) so
      PROJECT_SPEC §14's `human → hand → finger → cell → DNA` is a real chain the
      search *finds* rather than a list someone wrote down. 28 objects, still
      inside the 20–30 the docs ask for.
- [x] The chemical and biological chains were disconnected until a cell was
      related to water, which is where they genuinely meet. A test caught it.
- [x] Suggestions out of view are kept and labelled with how many decades of
      zoom away they are. Hiding them would defeat the point of "zoom in and
      there is more".
- [x] Most objects have no relations, and the panel says so rather than
      inventing any. A grain of sand is not part of anything in this catalog.
- [x] Adding four objects re-clustered the Atlas — Hand (0.19 m) now absorbs
      Coconut (0.20 m), so Coconut's label no longer appears at low zoom. That is
      correct decluttering, and it prompted a proper object picker, which also
      closes the "markers are pointer-only" gap from milestone 7.
- [ ] `semanticDetail` is read by `bandFor` but no fixture sets it; the derived
      ±2 decades is doing the work everywhere.
- [ ] Relations are length-only in effect. A `mass scale` projection (DATA_MODEL
      §15) needs the mass dimension first.
- [ ] The Ruler does not use the graph yet — it still picks nearby objects by
      size alone.

## Share state

- [x] Define versioned backend-free share URL schema.
- [x] Encode exact Rational/BigInt state losslessly.
- [x] Include lens, selection/experiment, representation config, camera, and relevant display state.
- [x] Add Share this view action and round-trip test.

Discovered while implementing:

- [x] Sharing forced a real architectural change, and a good one: every lens is
      now driven from `AppState` rather than keeping view state to itself. A lens
      whose state lives inside it is a lens whose state cannot be shared.
- [x] The payload lives in the URL *fragment*, which browsers never send to a
      server. "No backend required" is therefore structural rather than a
      promise — there is nowhere for the state to go.
- [x] Malformed exact values are fatal; malformed display values fall back.
      Silently substituting a different number is precisely the failure this
      project exists to expose, but a link that half-works still beats a blank
      page for an unknown lens or operation.
- [x] Two regressions the e2e tests caught, both caused by the controlled-state
      refactor: the Atlas → Ruler hand-off had been relying on the lens
      remounting into a fresh default, and the comparator had been seeding
      subject A from a prop that no longer existed. Both are now explicit
      transitions in the app shell, which is clearer than what they replaced.
- [x] Lens `onChange` props take an updater and are `useCallback`-stable, so the
      non-passive wheel listeners attach once and no lens needs a ref to read
      current state from an event handler.
- [ ] The share payload is uncompressed. `docs/NUMERICS.md` §14 permits
      compression; at ~500 characters it is not needed yet, and it would be a
      dependency for no present gain.
- [x] **Restoring read the fragment once at module load**, so the app never
      noticed the address bar changing. Back and forward between two shared views
      are same-document navigations: the URL moved and the screen did not. The
      URL is displayed state, so that is the same class of fault as misreporting
      a number. There is now a `hashchange` listener; an unreadable fragment
      reports itself and changes nothing, exactly as on a cold load, and an empty
      one restores what a bare URL opens rather than leaving the last view
      sitting under a URL that no longer describes it.
- [x] **The address bar went stale the moment you touched anything.** Sharing
      wrote the fragment and said a reload would restore the same view; one pan
      later that was false, and the URL still looked current. It is now cleared
      as soon as the state moves on from what the URL describes, and the link
      itself survives in the share field, relabelled "the view you shared, not
      the one on screen". `App` owns which state the URL describes, because the
      two things that make them agree — restoring a link and sharing a view —
      both live there. Getting this wrong once made restoring a link look like
      leaving it, which wiped the fragment mid-restore; the Playwright forward
      button caught it.
- [ ] Sharing uses `replaceState`, so it adds no history entry. Back from a
      shared view leaves the app rather than returning to the pre-share view.
      Deliberate for now — pushing an entry per share is defensible, pushing one
      per pan is not, and the line between them is a UX decision rather than a
      correctness one.
- [ ] Experiments are shared by id only. A user-authored experiment definition
      would need the full serializable form (which `steps.ts` already has) in the
      payload.

## Worker and CI

- [x] Move the experiment runner into a Web Worker.
- [x] Report progress and support cancellation.
- [x] Add CI running the full gate.

Discovered while implementing:

- [x] The runner needed no changes at all. Purity, chunked progress callbacks and
      a plain `{aborted}` signal were enough — which is the point of having said
      so in `docs/ARCHITECTURE.md` since milestone 4 rather than discovering it
      late.
- [x] Messages cross as the trace JSON the serializer already defines, so exact
      values travel as strings rather than relying on `structuredClone` carrying
      BigInt. That path was already tested; a second one would not be.
- [x] Cancellation is termination, not a flag. A worker cannot *read* messages
      while it computes — its own queue is blocked — and terminating is safe
      precisely because the runner has no side effects to unwind.
- [x] A real bug the e2e caught: cancelling left the panel stuck on "Running…"
      forever. Two different things cancel a run — the user, and the effect
      tearing down — and only the first should clear the flag.
- [x] One localized `eslint-disable` for `react-hooks/set-state-in-effect`.
      Starting a worker is the "synchronising with an external system" case
      effects exist for, and the run must be marked in flight the moment it
      starts.
- [ ] Only the experiment runner is off-thread. Catalog indexing and bulk
      comparison are still main-thread, and `docs/ARCHITECTURE.md` names both as
      later candidates.
- [x] CI runs now — the work branch pushes to GitHub and `.github/workflows/ci.yml`
      runs the whole gate on every push. Before the remote existed, the check was
      a clean clone into an empty directory and the pipeline in order.
      258 packages, no vulnerabilities, and typecheck, lint, format, 613 unit
      tests, build and 81 Playwright tests all green from nothing. The
      `allowScripts` block did its job and esbuild built itself. That covers
      "did I forget to commit something" and "does it build without my machine's
      state", which is most of what a first CI run finds.
- [x] The one thing a Windows clean room cannot cover is Linux's case-sensitive
      filesystem: `./exactnessTag` resolves to `ExactnessTag.tsx` here and fails
      there, so it is a breakage that cannot be reproduced on the machine that
      writes it. `src/imports.test.ts` checks all 429 relative imports against
      the on-disk names. `forceConsistentCasingInFileNames` catches a file
      imported two different ways; it does not catch one imported the wrong way
      once.
      The workflow is correct by inspection, not by observation.

## Accessibility and robustness

- [x] axe-core scan of every lens, WCAG 2 A and AA, run in CI.
- [x] Keyboard operation for the Ruler and the Atlas.
- [x] Visible focus ring.
- [x] Per-lens error boundary.

Discovered while implementing:

- [x] axe found **zero** violations across all five lenses before any fix. The
      semantic HTML, labelled controls and table headers used throughout carried
      it. Worth having measured rather than assumed.
- [x] The real gap was one axe cannot see: both SVG views were pointer-only. A
      `role="img"` SVG is not *expected* to be interactive, so nothing was
      technically wrong — it was just unusable without a mouse. They are now
      `role="application"` with `tabIndex`, a key map, and the keys named in the
      accessible label.
- [x] The key map is shared between the two views and pure, so they cannot drift
      apart and it can be tested without a browser. It deliberately returns
      `undefined` for Tab and Escape — swallowing those would trap focus.
- [x] The error boundary is per lens and keyed on it, so a failure clears when
      you switch away. React asked for one out loud in milestone 6 when a Ruler
      crash took the page down.
- [x] A robustness test feeds every lens `0`, negatives, `1e400`, empty and
      nonsense, and asserts the boundary is never reached. The guards hold; the
      boundary is a floor, not a crutch.
- [x] A share link naming a catalog id that no longer exists opens and explains,
      rather than failing. Links outlive builds.
- [x] `role="application"` — the checkable half of the claim. The role asks
      assistive technology to stop interpreting keys and hand every one to the
      view, so what the `aria-label` announces and what the handler takes must
      be the same set, in both directions. They are now held together by tests:
      every announced key works, every handled key is announced in words a
      listener can act on, and no unannounced key is swallowed. Plus the escape
      hatches, in the live browser: Tab and Shift+Tab both leave the region, and
      every capability the keys offer has an ordinary control outside it.
- [ ] Still not done with a real screen reader, which remains the actual test.
      The tests above reduce the risk — they would have caught a key silently
      stolen from the reader — but none of them can hear anything.
- [x] Skip link, as the first tab stop, moving focus to the lens container
      itself rather than only the URL fragment. Clipped rather than hidden, so
      it stays in the tab order — a skip link nobody can reach is worse than
      none, because it reads as done.
- [x] The palette is checked against a Viénot–Brettel–Mollon simulation of
      protanopia, deuteranopia and tritanopia (`src/ui/colourVision.ts`), read
      from `app.css` so the two cannot drift. Every text colour stays above
      6.5:1 under every simulation; `--accent` and `--warn` compress from 0.328
      to 0.238 apart but never collapse — and the exactness distinction does not
      rely on that anyway, since `ExactnessTag` writes the words.
- [ ] The simulation models dichromacy, not anomalous trichromacy — the common
      case, and a spectrum this cannot represent. It is evidence, not a
      substitute for asking someone.

## Pixel claims are measured, not nominal

The views state figures in pixels: "N px per red blood cell", "individual items
are below a pixel here", "10 px minimum marker spacing", "N px apart". Each SVG
drew into a fixed `viewBox` — 960 for the Ruler and Atlas, 640 for the
comparison strip — scaled by CSS `width="100%"`, so every one of those figures
was true at exactly one window width and false everywhere else.

Playwright measured it before anything was designed, and found two real defects:
the Ruler on a 420 px screen reported 5.76 px per red blood cell and drew 1.88,
and the Atlas drew the same 21 markers at 420 px as at 1400 px, so its 10 px
minimum spacing was not a minimum at all. A third test passed while being wrong:
it compared the reported grid step against the chosen step, both in viewBox
units, and so was self-consistently false.

- [x] `useMeasuredWidth` — a `ResizeObserver` behind a callback ref. The width is
      read during render, so it comes from state; the React compiler will not let
      a value that shares an object with a ref reach render, which is the right
      rule and is why this returns a tuple rather than an object.
- [x] Ruler, Atlas and comparison strip size their `viewBox` from the measured
      width, so one viewBox unit is one CSS pixel.
- [x] Both wheel listeners measure the element in the handler instead of closing
      over a width, so a resize cannot leave them zooming against a stale one.
- [x] Grid ticks carry `class="tick major"` / `"tick minor"`, so a test can hold
      the reported spacing against where the majors are actually drawn.
- [x] `e2e/pixels.spec.ts`: five tests comparing every reported figure against
      measured DOM geometry at 420, 800, 1280 and 1400 px.
- [x] docs/UI_SPEC.md states the rule and its consequence for the camera.

Three existing tests had baked in nominal-width figures ("9.6 mm across the
view", "333", framing) and now assert width-relative truths instead, which is
what they should always have asserted.

One limit, recorded honestly: a camera is a scale, not a span, so a preset framed
at one width shows a different fraction of the scene at another. Presets are
framed at the measured width when chosen, but the initial camera and the
Atlas → Ruler hand-off are built before the view has been measured, so they can
be off by the ratio of widths — a coconut handed over at a 1206 px panel fills
0.48 of it rather than 0.6. "Reset view" reframes at the true width. Fixing it
properly means distinguishing a camera that was framed from one that was
restored from a link, because reframing a shared link would break the promise
that a link reproduces the sender's view exactly.

## The tests were verifying the dev server

Playwright's `webServer` ran `npm run dev`, so all 55 flows exercised React's
development build — a different program from the one that ships. StrictMode
double-invokes effects there, prop validation and jsx dev warnings dominate the
render path, and errors surface differently. It now builds and serves the
production bundle on port 4173. All 55 pass against it, and faster.

This surfaced while profiling: the first profile was three-quarters React
development machinery — `jsxDEV`, `validateProperty`,
`defineKeyPropWarningGetter` — which is to say it was a profile of the wrong
program.

## Performance profiling — measured, nothing to fix

Main-thread cost per pointer-move during a drag, production bundle, CDP
`Performance.getMetrics`, this machine:

| view                       | script    | layout    |
| -------------------------- | --------- | --------- |
| Atlas drag                 | 1.43 ms   | 1.19 ms   |
| Ruler drag                 | 2.70 ms   | 0.50 ms   |
| Ruler drag, 80 notches in  | 2.03 ms   | 0.14 ms   |
| Ruler drag at a 1e20 m origin | 2.56 ms | 0.18 ms  |
| Ruler resize               | 0.28 ms   | 0.68 ms   |

Roughly five times inside a 16 ms frame, so the render path is left alone. Two
things worth recording:

- Zooming deep and moving the origin out to 1e20 m do **not** cost more. The
  exact rational math stays bounded, which is the claim the camera design makes,
  and it is now measured rather than argued.
- Resizing is cheap, so the per-render `rulerPresets` / `fullRangeCamera` /
  `declutter` recomputation the measured-width change introduced costs nothing
  worth memoising away.

No perf assertion is checked in: a timing threshold in CI is a flaky test, and
these numbers describe one machine.

- [ ] Re-measure on a phone-class device before claiming the drag is smooth
      there. 2.7 ms here could be 15 ms on a low-end Android.

## The documentation stated counts that nothing checked

`24 catalog objects` sat in the README and twice in this file for several commits
after the catalog grew to 28, and nothing failed. For a project whose subject is
numbers that do not lie, a stale number in the front door is worth a test rather
than a proofread.

`src/docs.test.ts` reads README.md and docs/DATA_MODEL.md and checks the claims a
machine can settle: the catalog size, how many objects are cited, how many are
not, and that the citation table in DATA_MODEL lists exactly the cited set. Prose
still needs reading; counts no longer do.

It found two wrong numbers on its first run — a good sign for the test and a bad
one for the sentence I had written a commit earlier. Nine objects are cited, not
seven: I had forgotten the coconut, which has carried
`source: "PROJECT_SPEC.md section 16"` since the fixture was written, and the
citation table I had just added was missing it too.

Also corrected while auditing: the README said Node 20 or newer, but Vite 7 wants
`^20.19.0 || >=22.12.0` — Node 20.0 through 20.18 would have failed obscurely.
`package.json` now carries the `engines` field the README claims it does.

## Five open items had already been done

The backlog is what I plan from, so a backlog that lies is worth the same audit
as documentation that lies. Checking every open item's premise against the code
found five that were false, some for several milestones:

- `ErrorContribution` "is currently produced by hand" — the runner computes the
  §7 decomposition and throws if `decompositionResidual` is non-zero.
- "Only addition is implemented on the finite machines" — `set`, `add`, `sub`,
  `mul` and `div` all are, and `mul` is what `(1/10) × 10` needs. That one
  claimed a CLAUDE.md required experiment could not run, which would have been
  serious had it been true.
- "`relations` is validated but empty" — 20 edges across 28 objects, which is
  what the Atlas walks.
- "The viewport is a fixed 960×260 viewBox" — fixed this week.
- "No keyboard navigation for selection" — the object picker is exactly that.
  Reworded rather than deleted: the markers really are still pointer-only hit
  targets, which is why the picker exists.

`src/docs.test.ts` gained a check for the rot class a machine *can* settle:
every backticked filename in the docs must exist, by path or by basename. It
found nothing today, which is the point of adding it before a rename rather than
after. It cannot tell a done item from an open one — that stays a reading job,
and this section is the record that it needs doing.

## I had never looked at the app

Eleven commits of verifying claims through tests, and I had never opened the
thing. Every check had gone through the DOM, which is exactly the wrong tool for
"is this readable". Five minutes of screenshots at 1280 px and 420 px found four
defects that 66 passing tests did not:

- The Atlas drew `Virus (representative)Human +1` as one run of characters.
  Labels were staggered using a fixed 96 px allowance whatever the label said,
  so a long name and a short one "fitted" and collided. It now measures the text
  that is actually drawn.
- Its decade axis read `10^-45 m10^-42 m10^-39 m` when zoomed out. The ticks all
  stay; only labels that would collide are dropped.
- The Ruler drew its unit symbol through the last tick label, so a 420 px screen
  read `µ200`.
- The Atlas's four controls did not wrap, so `Open in Ruler` sat off the right
  edge of a 420 px screen where it could not be reached at all.

Adding the edge-culling check then found a fifth: cluster labels near the right
edge were cut down the middle rather than dropped.

`labels.ts` holds the placement arithmetic, shared and pure. Width has to be
*estimated* there — those modules are DOM-free by design and
`getComputedTextLength` needs a live SVG — so the estimate errs wide, and
`e2e/labels.spec.ts` measures the real rendered boxes at four widths and asserts
nothing overlaps or runs off the edge. A bad estimate now fails loudly.

- [ ] Look at the app after any change to layout. A test suite that checks
      geometry through `getBoundingClientRect` cannot tell you the words are on
      top of each other; it will happily confirm that two unreadable labels are
      each exactly where the code put them.

## The other three lenses, once I looked at those too

Having found four defects in the two lenses I had screenshotted, I screenshotted
the other three. Four more, and one of them was my own unfinished work.

- **The Microscope and the Lab still drew into fixed viewBoxes.** The
  measured-width commit converted the Ruler, the Atlas and the comparison strip
  and missed three SVGs: both lattice rows and the resolution chart in the
  Microscope, and the disagreement strip in the Lab. Scaled into 340 px, a 10 px
  label renders at about four and a half. The Lab's strip is the worse of the
  two, because it discloses its magnification and how far apart the machines are
  *drawn* — figures that were false everywhere but at 820 px.
- **`.mono { overflow-wrap: anywhere }`** broke every value mid-token on a narrow
  screen: `2.939 × 10^-42 m` came apart as `2.93 / 9 × / 10^- / 42 m`. It was
  there so a 64-digit raw register could wrap. `break-word` breaks inside a token
  only when the token alone will not fit, which is what the register needs and a
  number does not.
- **`table.readout th` was `width: 14rem` and `white-space: nowrap`**, which sets
  a floor no 360 px screen can meet. With four columns the Lab's tables pushed
  the whole document to 455 px, so the page scrolled sideways on a phone. Row
  headers now wrap below 640 px, and `.panel` scrolls so a table that genuinely
  cannot fit takes its own scrollbar instead of the page's.

`e2e/narrow.spec.ts` holds both properties at 360 px and 420 px: the document is
never wider than the screen, and no SVG text renders below 7 px. Both are things
a person sees in one glance and a DOM assertion never mentions.

- [x] The resolution chart's legend is placed rather than assumed. `labels.ts`
      gained `chooseClearRect`, kept deliberately separate from the
      one-dimensional functions beside it because a legend is a block in a plane
      rather than a label on an axis. It counts *segments crossing* each
      candidate corner, not sample points inside it: the chart samples once a
      decade and the legend is narrower than a decade, so a point test would
      have called the box empty while the line ran through the words — the exact
      defect being fixed. Falsified by forcing the old corner back.
- [ ] Four corners is the whole search. A chart whose lines reach all four would
      fall back to the least-crossed one and keep its translucent backing, which
      is insurance rather than a fix. No such chart exists yet.

## The Comparator printed a rounded answer under a heading that said exact

The fifth lens, once I looked at that one too. `1 mm ÷ 7.5 µm` is 400/3, which
has no finite decimal, and the row headed **Exact value** read `133.333333333`
with nothing to say it had been cut off. `formatCount` returns `{ text, exact }`
and the view was using `.text` and discarding the flag — the information was
there and thrown away, under a heading asserting the opposite.

This is rule 2 of CLAUDE.md, in the lens whose whole job is answering "how many
X make Y". The Representation Lab had been tagging its renderings correctly since
milestone 1, so the two lenses disagreed about the same idea.

- [x] `ExactnessTag` moved out of the Lab into `src/ui`, so there is one way the
      flag is shown and the lenses cannot drift on it.
- [x] The Comparator tags the rendering, and when the decimal cannot be exact it
      prints the exact fraction underneath — `exactly 400/3`. The heading is now
      true rather than aspirational.
- [x] Audited the other 59 formatter calls. Two more were the same defect, both
      in the Lab: the **Exact reference** row, and the timeline's **Exact**
      column, which prints to four significant figures — so for `1/3 + 1/3 + 1/3`
      it read `3.333 × 10^-1 m` under a heading claiming exactness.
      `docs/NUMERICS.md` §15 now states the rule as a rule: the test is what the
      *label* claims, not what the call site does, since the flag will always be
      optional to use. In dense tables only rounded values are marked, so an
      unmarked one means exact.
- [x] Revisited, since many panels were added after that audit. Measured: 40
      call sites drop the flag today, across seven files, and every one is under
      a label that claims nothing — "Size", "Scale", "Across the view", "Grid
      step", "Quantization", "Relative error", "Looking at 1 m". The original
      judgment stands: a tag on every cell is noise rather than honesty. The
      Architecture Lab's panels are not among them — they use `Rendered` where a
      value is rounded and `describeWideLiteral` where it is an exact integer.
- [x] What the audit lacked was a guard. Conformance rule 5 tested
      `/exact/i`, which does not match "exactly" — the word boundary fails
      on the trailing "ly" — so a row header reading "Exactly" over an untagged
      value would have passed the rule written to catch exactly that. Verified
      against the old regex: "Exactly", "Exactness", "Precisely" and "True
      value" all missed; all four caught now, while "Size", "Scale" and "Looking
      at 1 m" still correctly do not match, so the vocabulary adds no noise.
      Falsified end to end: a planted "Exactly" label over the Ruler's untagged
      scale fails the sweep in two states.

## Tests that assert nothing is wrong

Writing the "rounded" test found it passing by scanning an experiment whose
values all render exactly — it asserted a label was missing and found it
missing. That is a shape, not a one-off, so I went through every negative
assertion in the suite. Three more could pass on an empty collection:

- the axe scan of each lens, if axe had run against nothing;
- the label-overlap tests, if the selector had matched nothing;
- the too-small-text test, likewise.

Each now counts what it examined first. For axe the evidence is `results.passes`
— rules run and nodes checked — because "no violations" is exactly what a scan of
an empty page reports.

The guards were then checked against deliberately empty collections rather than
assumed to work, which is the same discipline one level up. The ruler floor was
wrong on the first try: at 420 px the ruler draws three labels, not four, because
the unit symbol in the corner costs the last tick label. A floor should be
evidence the test looked, not a claim about how many labels there ought to be.

`docs/TEST_STRATEGY.md` states the rule.

- [x] At 420 px the ruler lost its rightmost tick label to the unit symbol. The
      symbol has moved below the baseline, where nothing else is drawn: it still
      sits beside the axis and no longer competes with it, and the ruler shows
      three tick labels on a phone instead of two.

## The three Comparator operations I had never opened

I had only ever exercised `how many A fit across B`. Opening the other three
found two defects, one of them mine from two commits earlier.

- [x] **`N × A, end to end` drew the subject against itself.** `endToEnd` sets
      `b` to `a`, because the operation has no second subject, and the strip took
      that literally: two identical bars, identically labelled, "Drawn to scale:
      1 shown". The comparison that operation actually makes is between one item
      and the total, which is the "123 coconuts end to end" picture in the
      project's own guiding phrases. The strip now draws that, and the fix is in
      the strip rather than in `endToEnd`, whose `b === a` is what correctly
      collapses the subject table to one row.
- [x] **The headline said `approximate` and the row beside it said `exact`**,
      about the same number, inches apart. One meant the red blood cell is a
      representative size; the other meant the digits are all of the value. Both
      true, both in the same two words. I introduced that when I added the
      rendering tag, having applied the mark-only-what-is-rounded convention to
      the Lab and not to the Comparator. `docs/NUMERICS.md` §15 already said
      which way this goes.

Also confirmed while looking: all six runnable experiments load and render, and
the two fixtures with no steps are correctly absent from the dropdown rather
than offering an empty run.

## Naming the pattern, and closing it

Nearly every defect found after the milestones came from one of two things: a
path nobody had walked, or a fix that was right where I was looking and missing
one panel over. Both are structural, and neither is answered by looking harder.

`e2e/conformance.spec.ts` enumerates 27 states — every lens, every Comparator
operation against two kinds of subject, every Ruler preset, five magnitudes in
the Microscope including the subnormal range, every runnable experiment — and
evaluates every invariant earned so far against the whole document at each, at
420 px and 1280 px.

It found four defects on its first run, in states nothing had visited:

- [x] At a 1e20 m origin the Ruler labelled a tick `100000000000000000000000`
      and let it run off the right-hand edge. The Atlas has had bounds since the
      label work; `RulerGrid` never got them. The pattern, exactly.
- [x] The Ruler's object rows are anchored at zero, which is off-screen in most
      presets, and their labels followed the bars over the edge. Pinned inside
      the view while any of the bar is, dropped when the view cannot hold them.
- [x] The disagreement strip staggered its machine labels by index parity, so
      with three machines the first and third shared a row — and at true scale
      they sit at the same x, which is the whole point of the picture.
      "Planck grid (256-bit)" printed through "binary64". Placed by width now,
      through the same helper as the other two views.
- [x] `Stored value (exact)` in the binary64 panel: a row header claiming
      exactness above a 55-digit decimal with no verdict attached. A third
      instance of the defect I had fixed twice, in a panel I had not thought to
      look at.

`Rendered` writes `data-exact` into the DOM so the exactness rule is structural
rather than inferred from digits. A panel that drops the formatter's flag now
fails the sweep instead of waiting to be seen.

- [x] At a 1e20 m origin the grid uses offset notation, which Daniel chose from
      the options queued in PLAN.md. The shared part is stated once beside the
      axis — `+1 × 10^23 mm` — and the ticks are labelled by their difference
      from it: −6, −5, −4 … 5. `offset + label × metresPerUnit` is the tick
      exactly, and a test asserts that on every major tick rather than trusting
      it. Twelve labels now fit where six used to collide.

      The offset is the roundest number within a span of the middle of the view,
      not the first tick and not the first tick floored: the first changes every
      time a tick scrolls off the edge, and the second produced
      `99999999999999999990`, which is round arithmetically and useless to read.
      It is also written out in full rather than to six significant figures —
      six figures is what made the labels identical in the first place, so
      rounding the offset would have made `offset + label` quietly false.

## An oracle that is not us

Every test here other than these was written by the same author as the code, at
the same time, holding the same idea of what the answer should be. That catches
slips and cannot catch a misconception — believe that ties round half away from
zero and you write the code and the test to agree.

`tools/oracle.py` is a second implementation with different bugs, using
`fractions.Fraction` and `struct`. `npm run oracle` regenerates
`fixtures/oracle.json`; `src/core/oracle.test.ts` compares. The fixture is
committed, so CI needs no Python.

- [x] 300 arithmetic cases, ~390 each of order-of-magnitude, exact-decimal,
      binary64 encoding and neighbour gaps. Generated cases include values
      exactly half an ulp above a representable double — the only input that
      separates ties-to-even from ties-away-from-zero — plus subnormals to
      10^-310, the largest finite double, and the first value past it.
- [x] The core agreed on every case, first run. That is the result I wanted and
      not the one I expected to be interesting.
- [x] Falsified before trusting: perturbing one expected product and one
      expected bit pattern makes it fail, so the comparison is real.

Two things the oracle taught rather than confirmed. Python's `float(Fraction)`
raises `OverflowError` rather than returning infinity, so past the top of
binary64's range the oracle applies the IEEE rule itself — on that one case it
asserts a rule rather than offering an independent implementation of one, and
says so where it does it. And the coverage assertions caught the fixture having
no overflow case at all before the comparison ran, which is the anti-vacuity
discipline paying for itself again.

- [x] **That claim was wrong and is corrected.** I wrote that the finite
      machines were outside the oracle's remit because Python's unbounded
      integers hide finiteness. True of an oracle that never asks, and wrong
      as a general claim: asked out loud they are the right tool, quantizing
      onto the Q128.128 and Planck grids exactly and then reporting whether
      the result fits the width, which is a plain integer comparison.
      `Fraction` still does the part that is hard to get right. 1,596
      Q128.128 cases across four base units, 399 Planck, 399 error meter,
      straddling every boundary: below the LSB, at exactly half an LSB, and
      past the top of each machine's range. All agreed.
- [ ] The overflow *policy* — checked, wrapping, saturating — is still not
      offered by the oracle, and this time for a reason that holds: it is this
      project's design rather than a shared rule, so a second implementation
      of it by the same author would be evidence of nothing.

## Auditing the app against the nine required experiments

CLAUDE.md names nine experiments to implement before adding many objects, and
says each "must expose enough internal state to explain its result". Seven were
there. Two were not, and both failed the same way: the machinery existed and the
demonstration did not.

- [x] **Required 7** — Q128.128 @ m holding 1 m, 1/2 m, 1 mm, 1 cm and 0.1 m.
      Every one of those could be typed into the Microscope individually, which
      is not the experiment: the lesson is the *pattern*, and a reader asked to
      enter five values and hold five answers in their head has not been shown
      it. Now one table.
- [x] **Required 9** — binary64 neighbour gaps at 0, 1 m, 1e6 m and 1e20 m. Same
      shape of gap, same fix. Four rows: 5 × 10^-324 m at zero, sixteen
      kilometres at 10^20 m, and one metre asymmetric because it is a power of
      two.

Writing the test for 7 taught me something I had assumed wrong. I expected
`0.1 m` to stay quantized when the machine moves to `@mm`, and it does not: at
`@mm` a metre is 1000 machine units, a centimetre is 10, a tenth of a metre is
100, so **all five become exact**. The base unit moved, not the digits. That is a
sharper statement of "the machine base unit is not the display unit" than the one
I was going to write, and the panel now says it.

- [ ] Required 6 (the same register at mm/m/km) is served by the existing "Pick
      your ruler" table, and required 1–5 and 8 by the Lab's fixtures. Worth
      re-auditing whenever the spec's list changes, since nothing checks the app
      against that list automatically — a test cannot read a requirement.

## Wide fixed-point / digit-serial architecture track (issue #1)

`docs/WIDE_INTEGER_ARCHITECTURE.md` arrived as an attachment on
https://github.com/DazzlingDukeOfLazers/1024/issues/1. It is a new experimental
track rather than a change to the existing one: a simulated machine that exposes
very wide fixed-point architectural values while doing the arithmetic on a much
smaller physical slice over multiple cycles.

> Keep the bits until someone explicitly chooses to throw them away.
> Return the leftovers.

**Only that one file was taken from the zip.** The attachment also carries an
older baseline of the other twelve documents, which would have removed the
configurable Q128.128 base unit, the per-representation `ErrorLedger`, the
floating-origin experiment, share state and the exact-safe camera log10 — all
shipped and tested. Confirmed with the author as a stale base rather than a
decision, so it was not applied. Do not apply it later either: check against this
note before treating that zip as a spec update.

What it asks for, roughly in dependency order:

- [ ] Radix-2^N digit decomposition over the existing wide values, with a
      configurable digit width (8/16/32/64/128) so the slice-size trade can be
      measured rather than assumed.
- [ ] Significant-width dispatch: report declared width against the significant
      width actually touched, and pick a path from it.
- [ ] Zero-digit skipping, with the control cost configurable so the saving is
      not assumed to be free.
- [ ] `MUL_WIDE` — 1024 × 1024 → 2048, wide first and narrow later, so
      calculation is separated from information loss.
- [x] `NARROW source → destination + residue`, with the policy list from §8.
      **One interpretation to be aware of**: §8 lists its twelve policies in a
      single block, and they are not alternatives to each other — rounding to
      nearest and saturating on overflow answer different questions. They are
      modelled as four orthogonal axes (rounding rule, range rule, inexact rule,
      residue rule), and each of the twelve names maps onto one setting of one
      axis. A flat enum would have needed a name per combination. That is a
      reading of the document rather than something it states.
- [ ] The visualization of full result / destination / residue from §8. The
      arithmetic is done; the picture is not.
- [x] `DIV_REM` holding `A = Q × B + R`, with the remainder a first-class result
      rather than a failure, and demand-driven extra quotient digits. Restoring
      radix-2, named in the result because §10 says not to lock the project to
      one algorithm before benchmarks exist — non-restoring, radix-2^N and
      reciprocal-based are open, and `DivisionState` is shaped to hold any of
      them.
- [x] A second division algorithm and the benchmark §10 asks for. Non-restoring
      radix-2: subtract unconditionally, let the remainder go negative, add back
      on the next step, and correct once at the end. Both algorithms are checked
      against all 140 oracle fixtures, because agreeing on every answer is the
      precondition for comparing their work.

      **Measured, on `(2^512 + 12345) ÷ 7`:**

      | algorithm | comparisons | add/subtracts | cycles at compare=0 | at compare=1 |
      | --- | --- | --- | --- | --- |
      | restoring | 513 | 168 | 681 | 1194 |
      | non-restoring | 0 | 514 | 1027 | 1027 |

      The crossover is sharper than I expected: restoring makes 513 comparisons
      to save 345 subtractions, so it wins only while a comparison is literally
      free and loses at a cost of one. Which is exactly why §10 says not to pick
      one before benchmarks exist — I would have picked restoring.
- [x] Radix-2^N and reciprocal-based division, the other two §10 names. Both
      landed, benchmarked, and oracle-checked; §10's list is complete.
- [x] Scenario settings (§14) so one workload runs under several policies. The
      four §14 names as values in `scenario.ts`, threaded through rather than
      ambient, and a workload runner that carries an exact rational reference so
      divergence is a fact rather than a comparison between two guesses.
      "Preserve everything" needed a decision: it cannot mean "never narrow" in a
      fixed-width machine, so it means narrow and carry the leftovers, which is
      what `ACCUMULATE_RESIDUE` supports and what the conservation test asserts.
- [x] The visualization of full result / destination / residue from §8, plus
      §22's wide-number chunks, significant-width band and multiplication matrix
      with skipped products faded — as a sixth lens, **Architecture Lab**. It is
      listed last and documented as an experiment rather than one of the five
      UI_SPEC names.
- [x] The metrics in §20 — significant width, partial products executed against
      skipped, modeled cycles, widest intermediate — shown beside the picture
      they describe.
- [ ] §22's animations: the accumulation of a partial product into the wide
      accumulator, and the quotient digits of a division appearing one at a
      time. Both are movement rather than layout, and everything here so far is
      a still.
- [ ] WebGPU compute track (§18), after the CPU simulation works.

Two notes on how this lands against what exists:

- §19 requires a CPU exact oracle and says "the simulator must never use its own
  result as its correctness reference". That is already built: `tools/oracle.py`
  and `src/core/oracle.test.ts`, differential-tested against
  `fractions.Fraction`. The new track should extend it rather than start again,
  and §19's list of cases — long carry chains, single-bit sparse values,
  min/max signed, division with remainder — is a good next generation of it.
- §23's precision statement is consistent with what the app already teaches: the
  architecture moves where error occurs rather than removing it. The Microscope's
  existing framing carries over.

## One conformance flake, hardened rather than diagnosed

The conformance sweep failed once at 420 px during a full run, passed on its own
immediately afterwards, and the passing rerun deleted the error context before I
read it. Twelve further attempts — four full suites and eight repeats of the
sweep under eight workers — did not reproduce it.

So this is a guess at the mechanism, and worth labelling as one. A measured view
renders at the old width, gets observed, and renders again; a sample taken
between those two is self-consistent and about to be replaced. `settled` now
requires two consecutive agreeing samples across an animation frame instead of
one. That cannot mask a real violation — an overlap is still an overlap on the
second look — and it removes the transient-read failure mode.

- [ ] If it recurs, capture the error context before rerunning. The diagnostic
      was lost to a reflex.

## The sweep was checking one axis of a two-axis problem

`e2e/conformance.spec.ts` tested that no label ran off the left or right of its
own drawing, and said nothing about the top or bottom. Adding the vertical check
found two clipped labels immediately: a caption I had just placed fourteen pixels
below its viewBox in the new lens, and — older, and reported clean every run
until now — the "off scale" labels in the Representation Lab's disagreement
strip, where the third machine's label fell outside a 96-pixel box.

A rule that covers one axis of a two-axis problem passes for the same reason a
rule that covers one panel of five does. Worth remembering the next time a check
looks complete.

## A rule set that could not tell blank from clean

`e2e/conformance.spec.ts` was written to stop defects arriving through paths
nobody had walked. Then a path nobody had walked went through it untouched:
selecting `Trap on any inexact result` — a scenario the Architecture Lab's own
menu offers — threw a `WideError` out of the narrowing, and the lens error
boundary replaced the entire lab with an apology. Adding that state to the sweep
did not fail the sweep, because all five rules were statements about drawn
things and a lens that drew nothing satisfied every one of them.

Two fixes, and they are different in kind:

- A trap is an answer, not a failure. The lab now catches the refusal, says
  which operation was refused and why, and keeps every panel that did not depend
  on it. §14's scenario C exists to refuse; refusing is the machine working.
- Rule 6: the lens drew at all, found by a `data-lens-failed` attribute on the
  error boundary rather than by its wording, and asserted in the boundary's own
  unit test so dropping it cannot silently disable the rule.

The anti-vacuity guard in that file counts labels across *all* states, so one
blank state never moved the total. Worth noting for the next guard: a floor on a
sum does not floor the parts.

## Two mutants, one width

The comparison tests went green and then survived cutting the wide machine from
128 fraction bits to 127. Not a bug — a coincidence. `2^126/5` has fractional
part .8 and `2^127/5` has .6, so both round up and the 128-bit answer is exactly
twice the 127-bit one; a tenth cannot separate those grids, and every workload in
the file was built from tenths. A third separates them.

The second survival was the instructive one. Having added tests that pin the
width, the mutant lived again: every new test passed the width in explicitly, so
the *default* — the value every other test in the file actually runs at — was
still unpinned. Fixing the case in front of me and missing the one beside it,
again, at the level of the test rather than the code.

## The identity that was only true at the end

§22 asks for `A = Q x B + R` to be displayed continuously while the quotient
digits appear. Writing the trace found that the identity is not true at every
step of *both* algorithms, in a way worth keeping rather than smoothing over.

Restoring division satisfies `consumed = quotient x divisor + remainder` after
every single bit. Non-restoring does not, because it records bit `k` from the
sign of `R_k` — so the recorded bits lag the signed digits by one step, and the
identity holds for the signed-digit accumulation instead. That lag is exactly
why the algorithm needs a final correction and the restoring one does not. The
trace carries both: `quotient` is what the machine recorded, `quotientSoFar` is
what the identity holds for, and the test asserts they agree once the run ends.

The first version of the test asserted the identity against `quotient` for both,
and failed at the first bit of the first case. The failure was the useful part.

- [x] Radix-2^N and reciprocal-based division (§10). The trace shape held
      radix-2^N unchanged; the reciprocal has no serial digits to trace, which
      is a fact about the method the panel now states.
- [ ] The quotient tape shows a 48-bit window. A run of 717 steps at 1.6 px a
      cell is a texture rather than a diagram, and the window is the fix; an
      autoplay control over it is not built.

## No answer to "which radix", only to "which radix for this size"

§10 said not to lock the project to one division algorithm before benchmarks
exist. There are four now — restoring and non-restoring radix-2, restoring
radix-4 and radix-8 — and the benchmark says something I would not have guessed.

On (2^512 + 12345) / 7:

    algorithm              shifts  compares  subtracts  table  cyc@0  cyc@1  cyc@4
    restoring-radix-2         513       513        168      0    681   1194   2733
    non-restoring-radix-2     513         0        514      0   1027   1027   1027
    restoring-radix-4         257       514        168      2    427    941   2483
    restoring-radix-8         171       513        167      6    344    857   2396

A higher radix does *not* buy fewer comparisons. Digit selection is a binary
search over the table of multiples, so it costs one comparison per quotient bit
whatever the radix. What it buys is iterations. What it costs is `radix - 2`
additions of table setup before the loop starts.

So the crossover is in the size of the division rather than in the cost weights.
On 1000 / 7 the ranking inverts: radix-8 costs 25 cycles against radix-2's 24,
because six additions of setup are not repaid by a loop that runs four times.
And non-restoring beats all three restoring variants once a comparison costs
four cycles, which no radix rescues them from, because none of them makes fewer
comparisons.

- [x] Radix-2^N division (§10).
- [x] Reciprocal-based division (§10). It did change the shape rather than the
      constants — its cost is decided by the multiplier, not the division.

## A mutant that hangs instead of failing

Mutation testing the radix loop, one mutant took the run past a ten-minute
timeout instead of failing: dropping the `+ 1` from the binary search midpoint
makes `middle` able to equal `low`, so the search stops making progress and the
division never returns. It also left the working tree mutated, since the revert
came after the run that never finished.

Two things worth keeping from that. The `+ 1` now carries a comment saying it is
load-bearing, because it reads exactly like an off-by-one to be tidied away. And
a mutation harness needs a per-run timeout and a revert that happens whether or
not the run completes — the version used here had neither.

## Every division algorithm §10 lists, and no winner among them

The reciprocal method is in, so §10's list is complete. It leaves the digit-serial
family entirely: Newton-Raphson on `x -> x(2 - Bx)` converges to `1/B`, every
operation in it is a multiplication, and the multiplies are charged by
`mulWide`'s own cost model rather than by a number invented for the occasion.

On (2^512 + 12345) / 7 it is the cheapest of the five, at 770 cycles against
radix-8's 857 — and that ranking is worth almost nothing on its own, because:

- it costs 18194 cycles with an 8-bit multiplier and 375 with a 128-bit one, so
  whether trading division for multiplication pays is a question about the
  multiplier rather than about the division;
- it needs a temporary of 1026 bits, which does not fit the 1024-bit register
  this project is named after, while every loop holds one bit;
- it is sensitive to operand sparsity, because `mulWide` skips zero digits: the
  same-size division costs it 770 sparse and 920 dense, which flips which method
  wins, while the loop moves by three cycles;
- it gets cheaper as the divisor gets wider and the loops do not: on 2^512 - 1
  the loop goes 861 -> 691 across divisor widths while the reciprocal goes
  861 -> 264;
- and on 1000 / 7 it is the worst of all five.

So there is no answer to "which division algorithm". §10 was right to refuse one.

- [x] Radix-2^N division (§10).
- [x] Reciprocal-based division (§10).
- [ ] §18's WebGPU compute track is now the only untouched section.

## Two things mutation testing found that a passing suite did not

**A correction loop that could not be reached.** The reciprocal's downward
correction — for an estimate that overshot — survived every mutant, because no
input can reach it. That is provable rather than lucky: `1/B - x(2 - Bx) =
B(1/B - x)^2 >= 0`, so a Newton step never lands above `1/B`, and truncating only
lowers it. It is an assertion now instead of a loop, because a loop that never
runs is a claim about behaviour that was never checked.

**A correction loop that could not be bounded.** The upward one was an open
`while`. With a converged estimate it runs once or not at all, but with a bad one
it does not cost more cycles — it runs an astronomical number of times on values
hundreds of bits wide and never returns. Two separate ten-minute timeouts found
that, and each left the working tree mutated, since the revert came after a run
that never finished.

`--testTimeout` does not help: the hang is a synchronous BigInt loop and there is
nothing for a test runner to interrupt. The fix belonged in the code rather than
the harness — the loop is bounded at four corrections and throws beyond it, so
the failure mode is a diagnosable error instead of a stall.

- [ ] The mutation procedure is still ad-hoc shell with a revert that only runs
      on success. Two hangs is enough; it should be a script with the revert in
      a `finally`.

## The §18 ladder, complete

Oracle → CPU → GPU → panel, in four commits. The u32-limb model prototyped in
Python against native ints; the CPU machine in src/core/limbs constrained the
way a shader is (bigint at the boundary only, carries by comparison, 32×32→64
from 16-bit halves because WGSL has no u64); the WGSL kernels textually
mirroring it, all 195 op fixtures passing bit-for-bit on this machine's RDNA-3
through branded Chrome; and the compute-lane panel drawing A + B from the
kernel's own carry trace, with a GPU row that reports agreement with the CPU
machine or says plainly that nothing was GPU-verified here.

Follow-ups deliberately not taken:

- [ ] §17's cooperating-lane organizations (one warp per scalar, one thread
      per several limbs). Everything so far is one invocation per op —
      correct first, parallel later, and the metrics are ready to price the
      difference when it comes.
- [ ] The panel visualizes ADD only. Op selector (SUB/MUL/DIV_REM views) is a
      question for Daniel in PLAN.md.
- [ ] Zero-limb skipping in mulLimbs, to mirror §4 at limb level. The dense
      baseline is what the GPU runs today, so the model matches the machine;
      revisit if a sparse GPU path ever exists.

## An expression that destroys before it can fail

The autoplay work's falsification pass truncated `usePrefersReducedMotion.ts`
to zero bytes. Not the mutation — the *restore*:

    io.open(p, 'w').write(io.open(p + '.bak').read())

evaluates `io.open(p, 'w')` first, which truncates the target, and only then
evaluates the read — which threw, because an earlier quoting failure meant the
backup never existed. The file was gone before the error could say so. Two
follow-on commands then reported nonsense ("no match" against an empty file, a
mutant "survived" against a build that could not start) before the truncation
was noticed by reading the grep that returned nothing.

`tools/mutate.py` was never affected — it holds the original in memory and has
no read at restore time. The rule for ad-hoc restores, now in PLAN.md: read the
backup into a variable first, write second, and guard on the backup existing.
Order of evaluation is a safety property when one side of an expression is
destructive.

## A visual baseline tolerance wide enough to hide the thing it was for

`e2e/visual.spec.ts` was locked with `maxDiffPixelRatio: 0.002`, guessed as
headroom for sub-pixel text rendering, and last session I wrote in a commit
message that the resolution-chart legend fix left the baselines unchanged.

That was false, and I had a passing test as my evidence. The legend did move —
top-right to top-left — and the diff came in under the tolerance. Then the ruler
offset work rewrote *every tick label in the view*, twenty-four-digit strings
replaced by one- and two-digit ones, and that passed too: 2278 pixels, ratio
0.0019, about a hundred pixels under the line.

Worse than a missed failure: at that tolerance `--update-snapshots` will not
rewrite the baseline either, because Playwright already considers it a match. So
the committed PNGs silently disagreed with the app they claimed to pin, and
would have gone on disagreeing.

Measured rather than guessed this time: three consecutive full runs at
`maxDiffPixelRatio: 0` differ by exactly zero pixels on this machine. The
headroom was for a problem that does not exist here, and it was wide enough to
hide two real ones.

- [ ] If these baselines ever move to a machine whose text rendering is not
      deterministic, the fix is a per-run noise measurement and a tolerance set
      from it — not a number that looks small.

## A source that names a consensus is not a source

Mutation testing the new citations found a gap between what the schema rejected
and what TASKS said it rejected. The whole-string placeholder set catches
`source: "TBD"`. It did not catch `"typical of structural biology texts; Arnott
& Hukins 1972…"` — a real reference wearing a vague qualifier, which is the
exact shape the note warned about, since "typical of the literature" is a claim
nobody can go and check.

The schema rejects a short list of consensus phrases anywhere in the string now,
with a test that every source already in the fixture still passes — a rule that
over-rejects would be as bad as one that under-rejects.

## Hardening

- [x] Playwright critical path.
- [x] Accessibility pass.
- [x] Pixel claims measured against the DOM.
- [x] End-to-end tests run against the production bundle.
- [x] performance profiling.
- [x] documentation refresh, with the checkable claims under test.
- [x] visual regression. `e2e/visual.spec.ts`: ten curated states at two
      widths, locked once §22's animations finished moving the Architecture
      Lab. Not the full sweep — the geometry rules already cover every state,
      and pixels only add the *unintended* change. Windows-rendered, so it
      skips on CI; procedure and sensitivity evidence in
      `docs/TEST_STRATEGY.md`.
