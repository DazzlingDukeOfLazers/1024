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

Requires Node.js 20 or newer.

```
npm install
npm test          # Vitest — the numerical core
npm run typecheck
npm run build
npm run dev       # http://localhost:5173

npx playwright install chromium   # once
npm run test:e2e
```

Current state: Milestones 0–2 of `docs/IMPLEMENTATION_PLAN.md`. The exact quantity
core and the finite machines (Q128.128 at a configurable base unit, the Q512.512
error meter, the Planck grid, and the per-representation ErrorLedger) are
implemented and tested. Milestone 3 is the binary64 inspector.

The five lenses are placeholders except for the Representation Lab, which holds
deliberately ugly debug panels that exercise the core in a browser. The lab UI
from `docs/UI_SPEC.md` arrives with the experiment runner.

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
