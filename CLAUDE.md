# CLAUDE.md — Scale Atlas / Numerical Microscope

## Mission

Build an interactive, rigorous, playful web application that helps users understand:

1. physical scale;
2. dimensional comparison;
3. finite numerical representations;
4. floating-point and fixed-point error;
5. how different representations drift while attempting to describe the same mathematical quantity.

The application is not a claim that spacetime is discretized. The Planck-grid model is explicitly a representation thought experiment.

## Read before coding

Read, in order:

1. `PROJECT_SPEC.md`
2. `docs/ARCHITECTURE.md`
3. `docs/NUMERICS.md`
4. `docs/DATA_MODEL.md`
5. `docs/UI_SPEC.md`
6. `docs/TEST_STRATEGY.md`
7. `docs/IMPLEMENTATION_PLAN.md`
8. `TASKS.md`

Then, for the experimental architecture track only:

9. `docs/WIDE_INTEGER_ARCHITECTURE.md`

If implementation conflicts with these docs, prefer numerical correctness and update the docs in the same change.

`docs/NUMERICS.md` is the single source of truth for representation semantics. Do not duplicate or creatively reconcile conflicting machine definitions elsewhere.

---

## Non-negotiable design rules

### 1. Exact truth is separate from machine representations

Never use JavaScript `number` as the authoritative quantity representation.

For values that are mathematically rational, preserve an exact `BigInt` rational representation.

Every simulated representation must be derived from the exact intent and must maintain its own state.

### 2. Do not hide error

The point of the project is partly to expose representation error.

Do not "helpfully" normalize, round away, or silently correct a machine representation before comparison.

Display formatting may round for humans, but the underlying state and error must remain inspectable.

### 3. Give every simulated representation its own ErrorLedger

Signed error can cancel, and operand encoding error is different from arithmetic rounding/quantization. Track at least, per representation:

- exact reference result;
- simulated result;
- current signed/absolute divergence;
- operand encoding error;
- operation rounding/quantization error;
- cumulative absolute error by event category;
- relative error where defined;
- binary64 neighbor gaps / clearly defined ULP-style metrics where meaningful.

Do not use one global error bucket for all machines.

### 4. The 1024-bit systems are finite experimental machines

Implement three conceptually distinct references:

#### Planck spacetime machine

Four signed 256-bit integer registers:

- X: Planck lengths
- Y: Planck lengths
- Z: Planck lengths
- T: Planck times

Total: 1024 bits.

Do not describe this as physical reality.

#### Metric spacetime machine

Four signed Q128.128 registers with a **configurable exact base unit**. Default: meters.

Examples:

- `Q128.128 @ mm`
- `Q128.128 @ m` (default)
- `Q128.128 @ km`

Total: 1024 bits.

For exact base-unit scale `B` meters per machine unit:

`decoded meters = raw × B / 2^128`

Changing the machine base unit changes physical range/resolution. Changing only the display unit must not change machine state.

Use `ct` as the fourth coordinate internally unless a later experiment explicitly requires raw seconds.

#### Error accumulator machine

Use a signed Q512.512 fixed-point register as the finite 1024-bit error accumulator for v0.

Interpretation:

`raw / 2^512` in the quantity's canonical SI unit.

This is intentionally finite and belongs to a representation-specific `ErrorLedger`. Keep exact rational error diagnostics separately so we can measure the 1024-bit accumulator's own quantization/overflow behavior.

**ExactReference is unbounded exact rational truth; Q512.512 is a finite error meter. Never call the Q512.512 system an exact shadow.**

If a future architecture decision replaces Q512.512, update `docs/NUMERICS.md`, relevant docs, and tests together.

### 5. Overflow behavior must be explicit

Do not allow JavaScript `BigInt`'s unbounded range to accidentally make a finite simulated machine infinite.

Provide explicit helpers for:

- signed-width bounds;
- two's-complement wrapping;
- checked overflow;
- saturating mode if useful for demonstration.

Default experiments should use **checked overflow** and surface overflow as an event. Wrapping may be selectable for demonstrations.

### 6. Native SVG first

The main Atlas and Ruler renderers are browser-native SVG.

Do not begin with canvas or WebGL.

Three.js is optional and later.

Do not attempt to cross-compile Three.js into Godot.

Share the data/quantity model, not renderers.

### 7. Rendering coordinates are not physical coordinates

Never pass universe-scale SI coordinates directly into SVG geometry.

Maintain a camera transform that maps physical/logarithmic coordinates into modest screen-space numbers.

Rendering should normally operate in pixel-scale values.

### 8. Atlas and Ruler are different coordinate views

- **Atlas:** logarithmic position by order of magnitude.
- **Ruler:** locally linear and preserves true relative size.

Do not fake a single view that compromises both.

### 9. Engineering notation is the default

Favor powers of `10^3` and SI prefixes:

pm, nm, µm, mm, m, km, Mm, Gm, etc.

Grid spacing may use pleasant `1 / 2 / 5 × 10^n` intervals, but labels should make engineering-prefix boundaries legible.

### 10. Objects contain uncertainty/ranges

Do not invent false precision for physical things.

A catalog object may have:

- representative value;
- min/max range;
- provenance;
- confidence/quality metadata.

Comparison output must distinguish exact unit conversion from approximate physical comparison.

### 11. Asset providers are optional

The Noun Project may be an asset provider, not the data model.

The app must work with:

- bundled SVG;
- custom SVG;
- OpenMoji/Wikimedia/other providers;
- procedural fallback shapes;
- no visual at all.

Do not couple object identity to an external icon ID.

---

## Coding conventions

- TypeScript strict mode.
- Pure functions for numerical core wherever practical.
- No DOM access from the numeric/domain packages.
- No hidden global mutable state.
- Keep units explicit in types and names.
- Prefer immutable experiment steps.
- Serialize `BigInt` values through explicit string encoders.
- Never JSON-stringify raw `BigInt`.
- Tests accompany every numerical primitive.
- Add comments where representation semantics are non-obvious, not where code is self-explanatory.

Suggested package boundaries:

```text
src/
  core/
    rational/
    units/
    representations/
    experiments/
    quantities/
  catalog/
  camera/
  renderers/
    svg/
    three/
  features/
    atlas/
    ruler/
    comparator/
    microscope/
    representation-lab/
  ui/
```

---

## Development order

Do not start with polish.

Order of implementation:

1. exact rational core;
2. unit and engineering-notation core;
3. finite-width integer helpers;
4. Q128.128 implementation;
5. configurable Q128.128 base-unit semantics;
6. Q512.512 error accumulator + per-representation ErrorLedger;
7. exact binary64 decode/encode inspection including ±0/Inf/NaN and asymmetric neighbor gaps;
8. compact repeat runner and error accounting;
9. catalog schema and fixtures;
10. exact-safe camera/grid math and Rational log10;
11. ruler proof of concept;
12. atlas proof of concept;
13. versioned shareable URL state;
14. representation-lab visualization;
15. comparator;
16. progressive semantic detail;
17. optional Three.js.

The first useful milestone should be ugly but numerically trustworthy.

---

## Required initial experiments

Implement these before adding many objects:

1. `0.1 + 0.2`
2. `(1 / 10) × 10`
3. add `1 mm` 1,000,000 times
4. `+1e20 m`, `+1 mm`, `-1e20 m`
5. `1/3 + 1/3 + 1/3`
6. compare the same 256-bit Q128.128 register configured at `mm`, `m`, and `km`, including range and LSB;
7. compare Q128.128 @ m representation of:
   - 1 m
   - 1/2 m
   - 1 mm
   - 1 cm
   - 0.1 m
8. floating-origin/rebasing demonstration at a `1e20 m` offset
9. show binary64 neighbor gaps near:
   - 0
   - 1 m
   - 1e6 m
   - 1e20 m

Each experiment must expose enough internal state to explain its result.

---

## Definition of done for a numerical feature

A numerical feature is not done until:

- expected behavior is documented;
- exact reference behavior is tested;
- boundary/overflow behavior is tested;
- conversion error is tested;
- the UI labels exact vs approximate values correctly;
- values can be serialized/restored without losing information.

---

## Do not do these yet

Until the v0 numerical and SVG ruler behavior is stable, do not spend time on:

- authentication;
- cloud backend;
- databases requiring a server;
- multiplayer;
- Godot integration;
- elaborate Three.js scenes;
- mass/momentum physics;
- relativity simulation;
- live Noun Project API integration;
- hundreds of catalog entries;
- visual design systems beyond what is needed for clarity.

---

## Working style for Claude Code

When starting a task:

1. Read the relevant design docs.
2. State the smallest implementation slice.
3. Inspect existing code before creating parallel abstractions.
4. Add/adjust tests first for numerical behavior when practical.
5. Implement.
6. Run tests/typecheck/build.
7. If browser behavior changed, run the relevant Playwright flow.
8. Update `TASKS.md` with completed work and discovered follow-ups.
9. Update architecture/spec docs when a design assumption changes.

Prefer small, reviewable commits and deterministic tests.

Never silently change a representation definition because another one would be easier to implement.
