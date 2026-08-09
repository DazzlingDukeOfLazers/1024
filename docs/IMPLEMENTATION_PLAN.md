# Implementation Plan

## Milestone 0 — Repository bootstrap

Deliver:

- Vite + React + TypeScript
- strict TypeScript
- Vitest
- Playwright
- lint/format
- basic app shell
- no visual design work beyond readable layout

Acceptance:

```text
npm test
npm run typecheck
npm run build
```

all pass.

---

# Milestone 1 — Exact quantity core

Build:

- `Rational`
- canonical unit quantities for length/time
- exact SI prefix conversions
- engineering formatter
- exact-safe Rational order-of-magnitude/log10 display utility
- serialization

Demo UI may be a debug panel.

Acceptance:

- exact rational tests pass;
- `1 mm = 1/1000 m` exactly in the reference model;
- changing display prefix does not alter value;
- huge/tiny Rational log10 placement works without first coercing the full value to `Number`.

---

# Milestone 2 — Finite machines

Build:

- finite signed integer helpers;
- Q128.128 with configurable exact base unit;
- Q512.512 finite error accumulator;
- per-representation ErrorLedger model;
- explicit overflow events;
- Planck integer register type;
- representation interface.

Do not build beautiful visualization yet.

Acceptance:

- Q128.128 exact/inexact fixtures at `@m`;
- compare `@mm`, `@m`, and `@km` range/LSB behavior;
- display-unit changes do not mutate machine configuration;
- width enforcement proven by tests;
- quantization exposed, not hidden.

---

# Milestone 3 — Binary64 inspector

Build:

- DataView bit extraction;
- exact rational decode;
- predecessor/successor with `gapBelow` and `gapAbove`;
- preserve +0/-0 and finite/Infinity/NaN categories;
- binary field display.

Acceptance:

- known IEEE-754 bit-pattern tests pass, including +0/-0, infinities, NaN, powers-of-two gap asymmetry;
- user can enter `0.1` and inspect exact stored binary64 value.

---

# Milestone 4 — Experiment runner

Build a serializable operation runner with immutable atomic steps and compact first-class repeat steps.

Run ExactReference + representations in parallel.

Track per representation:

- current divergence;
- operand encoding error;
- operation rounding/quantization error;
- cumulative absolute diagnostics by category;
- finite Q512.512 error accumulator.

Long repeats execute every operation but retain only configured checkpoints plus final statistics. Provide chunk/progress callbacks.

Ship built-in experiments from `fixtures/experiments.json`.

Acceptance:

- million-mm and large-offset experiments are deterministic;
- million-mm performs one million real machine additions without one million heavyweight trace records;
- no representation reads another representation's state;
- trace can be serialized/restored.

---

# Milestone 5 — Catalog + simple comparator

Load 20–30 fixture objects.

Build:

- search/select object;
- ratio;
- how-many-fit;
- arbitrary count;
- exact vs representative labeling.

Acceptance:

- red-blood-cell ↔ millimeter comparison;
- 123 coconuts end-to-end;
- uncertainty/range is shown when present.

---

# Milestone 6 — Linear SVG ruler

Build:

- exact-centered camera strategy;
- scalable engineering grid;
- native SVG object placement;
- pan/zoom;
- level-of-detail.

Acceptance:

- transition from meters to mm to µm without coordinate instability;
- at a `1e20 m` camera origin, objects 1 mm apart remain separately drawable because origin subtraction happens exactly before Number conversion;
- grid changes without scene jumping;
- RBC sequence collapses/expands based on pixel density.

---

# Milestone 7 — Logarithmic Scale Atlas

Build:

- exact-safe Rational log10/order-of-magnitude positioning;
- object decluttering;
- engineering boundary labels;
- click-to-center;
- jump to Ruler.

Acceptance:

- navigate from microscopic to astronomical scales;
- no use of giant SVG coordinates;
- values beyond binary64 exponent range can still be positioned by the atlas;
- selected object persists between lenses.

---

# Milestone 8 — Shareable state

Build:

- versioned URL schema;
- exact string encoding for rational/BigInt state;
- selected lens/object/experiment state;
- representation configuration including Q base unit;
- camera state;
- copy/share action.

Acceptance:

- a large-offset disagreement view can be copied as a URL and restored without numerical loss;
- no backend required.

---

# Milestone 9 — Representation Lab UI

Build:

- row per representation;
- step timeline;
- error metrics;
- raw representation inspector;
- Zoom to Disagreement;
- floating-origin/rebasing demonstration.

Acceptance:

- execute built-in experiments;
- divergence visualization is physically scaled;
- magnification disclosure always visible when error is exaggerated.

---

# Milestone 10 — Numerical Microscope

Build:

- local representable values for Q128.128 at selectable machine base units;
- side-by-side "Same 256 bits. Pick your ruler." range/resolution view;
- neighboring binary64 values with separate below/above gaps;
- local spacing ruler;
- raw bits;
- move reference magnitude.

Acceptance:

- user can visually see binary64 spacing grow while Q spacing remains constant for a selected Q base unit;
- user can switch Q machine base units and see the physical range/resolution tradeoff.

---

# Milestone 11 — Progressive semantic graph

Build:

- relations;
- scale-sensitive related-object suggestions;
- graph navigation.

Keep it simple.

Do not build a generic graph database unless the fixture data actually requires one.

---

# Later

Only after v0 is coherent:

- richer asset providers;
- Three.js;
- mass;
- area/volume;
- momentum;
- uncertainty propagation;
- decimal fixed point;
- alternate floating-point widths;
- user-defined objects;
- Godot adapter;
- PWA/offline packaging.
