# Architecture

## Principle

One domain model, multiple numerical representations, multiple views.

```text
                         Exact user intent
                               |
                         Quantity engine
                               |
               +---------------+----------------+
               |                                |
        Representation engine              Object catalog
               |                                |
   +-----------+-----------+                    |
   |           |           |                    |
Planck    Q128.128@B    binary64          relationships/assets
machine   metric machine   machine                |
   |           |           |                     |
   +-----------+-----------+---------------------+
                       |
                 Experiment state
                       |
          +------------+-------------+
          |            |             |
        Atlas        Ruler      Numerical lab
          |            |             |
      Native SVG   Native SVG    SVG/HTML
                       |
                  Three.js later
```

## Layering

### `core/rational`

Authoritative exact rational arithmetic.

Responsibilities:

- normalized numerator/denominator;
- exact add/subtract/multiply/divide;
- comparison;
- sign;
- powers of 2/10;
- conversion to/from exact integers;
- formatting helpers that do not mutate value.

### `core/units`

Dimensions and SI conversion.

Responsibilities:

- length/time initially;
- canonical SI representation;
- engineering prefix selection;
- unit compatibility checks;
- exact conversion factors wherever SI defines them exactly.

Do not add mass/momentum until length/time workflows are stable.

### `core/representations`

Finite simulated computers.

Initial implementations:

- `PlanckInt256`
- `Q128_128` with exact configurable base-unit scale
- `Binary64Inspector` with full IEEE state categories
- per-representation `ErrorLedger`
- `Q512_512ErrorAccumulator`
- shared finite-width signed integer utilities

Every representation exposes, where meaningful:

- encode exact value;
- decode represented finite value to exact rational;
- perform supported operations;
- report operand-encoding and operation-rounding/quantization events;
- own an independent `ErrorLedger`;
- report overflow/underflow/special-state events;
- describe local resolution / neighbor gaps.

### `core/experiments`

Runs one sequence of operations against multiple representations.

An experiment step is immutable and serializable.

Example:

```ts
type AtomicExperimentStep =
  | { op: "set"; value: QuantityLiteral }
  | { op: "add"; value: QuantityLiteral }
  | { op: "sub"; value: QuantityLiteral }
  | { op: "mul"; value: ScalarLiteral }
  | { op: "div"; value: ScalarLiteral };

type ExperimentStep =
  | AtomicExperimentStep
  | {
      op: "repeat";
      count: number;
      step: AtomicExperimentStep;
      trace?: { first?: number; last?: number; checkpoints?: number[] };
    };
```

The runner executes every machine operation, but long repeats store only requested checkpoints plus final statistics by default. Expose chunk/progress callbacks so the runner can move to a Worker without redesigning the core.

### `catalog`

Physical object graph.

Objects are independent from visuals.

### `camera`

Maps physical/logarithmic scale to safe render-space coordinates.

No browser DOM dependencies.

Camera math must subtract exact/domain origins before conversion to bounded render numbers. Atlas logarithms must use an exact-safe Rational order-of-magnitude path rather than coercing huge rationals directly to `Number`.

### `renderers/svg`

Browser-native SVG adapters.

### `features`

User-facing orchestration.

Features may combine domain state and renderer state but must not contain authoritative numerical logic.

---

# State model

Keep these states separate:

1. **Exact mathematical state**
2. **Per-representation machine state**
3. **Catalog state**
4. **Camera/view state**
5. **Display formatting preferences**

Changing engineering display units must never alter machine state.

Changing zoom must never alter physical quantities.

---

# Browser performance

Do not render thousands of detailed SVG objects if they collapse below a pixel.

Use level-of-detail and aggregation:

- detailed object above visibility threshold;
- simplified glyph at intermediate scale;
- density/line/aggregate representation when individual items are subpixel.

For "1,000 red blood cells end-to-end," the underlying count can remain 1,000 while rendering switches between individual cells and an aggregate strip.

---

# Worker boundary

Do not prematurely move everything into Web Workers.

The experiment runner should be worker-ready from the start through pure state transitions and streaming/chunk callbacks. A worker may be introduced when UI responsiveness requires it for:

- very long repeated-operation experiments;
- catalog indexing;
- expensive bulk comparison.

Keep the core pure so moving it into a worker is easy later.

---

# Persistence

v0 should be local-first.

Persist:

- user display preferences;
- saved comparisons;
- saved experiment definitions;
- camera bookmarks.

Also implement **versioned shareable URL state in v0** for the active lens, selected objects/experiment, representation configurations, and camera state. URL state must preserve exact values via string encodings and must not require a backend.

Use a versioned serializable schema.

---

# 3D

Three.js is a consumer of the domain model, never the source of truth.

Introduce it only when a particular scene needs actual spatial depth.

Examples:

- Earth/Moon geometry;
- orbital distances;
- light cone;
- extruded silhouettes.

Do not rewrite the ruler or atlas in Three.js just because Three.js exists.
