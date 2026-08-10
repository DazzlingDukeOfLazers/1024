# Scale Atlas / Numerical Microscope

An interactive browser application for understanding physical scale, numerical representation, and computational error.

The project combines several synchronized views of the same quantity/object graph:

- **Scale Atlas** — logarithmic navigation across orders of magnitude.
- **Metric Ruler** — locally linear, true-relative-size comparisons.
- **Counter / Comparator** — questions like "how many red blood cells span 1 mm?" or "123 coconuts end-to-end."
- **Numerical Microscope** — inspect representable-number spacing, ULPs, and error.
- **Representation Lab** — run the same operation through several number systems and watch them drift.
- **Shareable numerical failures** — copy a URL that restores an experiment, representation configuration, and camera state.

The core educational idea is:

> Scale, representation, and precision are different things.

This repository is intended to be built incrementally. Correct numerical behavior comes before elaborate rendering. `docs/NUMERICS.md` is the single source of truth for machine semantics.

## Recommended stack

- TypeScript
- React
- Vite
- Native browser SVG for the main 2D renderer
- BigInt-backed exact rational arithmetic for authoritative calculations
- Three.js only for later 3D scenes where 3D communicates something useful
- Vitest for unit/property tests
- Playwright for interaction/regression tests

Do **not** make Three.js, Godot, or an external icon service a dependency of the core quantity engine.

## Getting started

Requires Node.js `^20.19.0 || >=22.12.0`, which is what Vite 7 needs. The
`engines` field in `package.json` says so, so npm will tell you rather than
letting the build fail obscurely.

```
npm install
npm test          # Vitest — the numerical core
npm run typecheck
npm run build
npm run dev       # http://localhost:5173

npx playwright install chromium   # once
npm run test:e2e  # builds, then serves the production bundle on :4173
```

The end-to-end suite deliberately does not run against the dev server. React's
development build is a different program — it double-invokes effects under
StrictMode, spends most of its render path in prop validation, and reports errors
differently — so testing it verifies something other than what ships.

Current state: Milestones 0–11 of `docs/IMPLEMENTATION_PLAN.md` — the whole v0
plan. All five lenses are live, on top of the exact quantity core, the finite
machines (Q128.128 at a configurable base unit, the Q512.512 error meter, the
Planck grid, and the per-representation ErrorLedger), the binary64 inspector, the
experiment runner, the catalog and shareable state. The built-in experiments run
in a Web Worker — including a million real millimetre additions per machine, in
about a second and a half, with progress, cancellation, and a trace of
twenty-odd samples. What remains is the Hardening list in `TASKS.md`.

**Zooming is both metric and ontology navigation.** The Atlas walks the object
graph from the selection — `human → hand → finger → skin cell → DNA` is found by
search, not written down anywhere — and says how many decades of zoom away each
related object is. Objects with no relations say so rather than inventing any.

**What numbers can this computer see here?** The Microscope draws each
representation's local lattice at its own scale, walking real binary64
neighbours so the asymmetric gap at a power of two shows up as an asymmetric
gap. Its resolution chart shows binary64's spacing climbing a decade per decade
of magnitude while a fixed-point grid stays flat — and the two lines crossing,
because far below a zeptometre the float is the finer of the pair.

**Zoom to disagreement** draws every representation at true scale first, where
they genuinely occupy the same pixel, then magnifies until they separate — and
always says by how much. A 10^13x exaggeration that did not disclose itself would
be teaching the opposite of the point.

**Share this view** produces a versioned link that restores the lens, the
selection, the comparison, the experiment, the Q128.128 machine base unit and
both cameras. Exact values cross as strings, so a camera parked at
`10^20 m + 1 mm` comes back as the identical rational. The payload lives in the
URL fragment, which browsers never send to a server — "no backend required" is
structural rather than a promise.

The ruler's camera centre is an exact rational, so panning out and back returns
to exactly where it started, and a millimetre stays resolvable with the camera
sitting 10^20 m from zero. The atlas positions magnitudes through an exact-safe
log10, so it places 10^-35 and 10^27 on one axis — and would place 10^400, which
has no `double` at all.

The 28 catalog objects span about 10^-35 m to 10^27 m. Eleven are cited — two IAU
definitions, CODATA figures for the Planck length, the proton and the hydrogen
atom, WGS 84 for the Earth, NASA for the Moon, IAU for the Sun, and the project
spec for the coconut, NASA for Neptune's orbit, and fibre diffraction for the
DNA helix. The other 17 are
plausible round numbers with no source, and every lens that shows one says so in
the same words — the Atlas under the selection, the Comparator beside each
subject, the Ruler beside the object it is drawing to scale. A value may only
call itself `exact` or `measured` if it cites something; the schema throws
otherwise. See `docs/DATA_MODEL.md`.

Every lens is keyboard-operable and scanned by axe-core against WCAG 2 A and AA
in CI, and each is wrapped in an error boundary so a failure costs you one lens
rather than the page.

## Start here

See `REVISION_NOTES.md` for the architectural changes incorporated in this revision.


Claude Code should read these in order:

1. `CLAUDE.md`
2. `PROJECT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/NUMERICS.md`
5. `docs/DATA_MODEL.md`
6. `docs/UI_SPEC.md`
7. `docs/TEST_STRATEGY.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `TASKS.md`

## Guiding phrases

- "We have an irresponsible amount of coordinate space."
- "Zoom to disagreement."
- "What numbers can this computer see here?"
- "Abuse the Computer."
- "How many coconuts is that?"
