# Scale Atlas / Numerical Microscope

## Project concept

Build an interactive web application for exploring physical scale, numerical representation, and computational error.

The project should help people understand both:

- **how large or small things are**, conceptually and numerically
- **how computers represent those quantities**, including the ways different numerical systems drift from exact mathematical values

The app should be playful enough to answer questions like:

- How many red blood cells fit across a millimeter?
- What does 123 coconuts look like end-to-end?
- How many Planck lengths fit inside a floating-point rounding error?
- How many bits are required to represent the observable universe at a chosen resolution?
- What happens if we add 1 mm a million times using different numerical systems?
- At what scale does binary64 stop being able to distinguish a millimeter?

The app should avoid implying that spacetime is literally pixelated. The Planck-scale model is a **representation thought experiment**, not a claim about the physical structure of the universe.

---

# Core design idea

The application has several synchronized ways of looking at the same quantity/object graph:

| Lens | Question |
|---|---|
| **Scale Atlas** | What order of magnitude is this? |
| **Metric Ruler** | What does the actual size difference look like? |
| **Counter / Comparator** | How many X make Y? |
| **Numerical Microscope** | What did the computer lose while calculating it? |
| **Representation Lab** | How do different number systems drift? |

All views should operate on the same underlying catalog of physical objects, units, dimensions, and relationships.

---

# 1. 1024-bit Planck reference frame

Use a deliberately excessive 1024-bit spacetime coordinate representation.

```text
X: 256 bits
Y: 256 bits
Z: 256 bits
T: 256 bits
```

The conceptual rule is:

```text
1 spatial LSB = 1 Planck length
1 temporal LSB = 1 Planck time
```

This is not intended as a literal model of spacetime. It is a fixed-grid information thought experiment:

> If we chose Planck units as the least-significant unit, how many bits would we need to address physically meaningful ranges?

The 1024-bit version is intentionally overbuilt.

With 256 bits per coordinate, the available range greatly exceeds the dimensions and age of the observable universe.

This should be part of the personality of the project:

> We have an irresponsible amount of coordinate space.

---

# 2. 1024-bit intuitive metric reference frame

Add a second 1024-bit representation intended to remain intuitive in ordinary SI-like units.

Each spacetime coordinate is a signed **Q128.128 fixed-point value**:

```text
[ signed 128-bit integer ][ 128-bit fractional ]
```

Total:

```text
X: 256-bit Q128.128
Y: 256-bit Q128.128
Z: 256-bit Q128.128
T/CT: 256-bit Q128.128

Total: 1024 bits
```

The important change is that the **machine base unit is configurable**.

Let `B` be an exact rational number of meters per machine unit:

```text
decoded meters = raw × B / 2^128
```

Useful presets:

```text
Q128.128 @ mm
Q128.128 @ m   (default)
Q128.128 @ km
Q128.128 @ Mm
```

This makes the same 256 physical bits a direct lesson in the range/resolution tradeoff:

> Same bits. Pick your ruler.

A smaller base unit gives finer absolute resolution but less physical range. A larger base unit gives more physical range but coarser resolution.

For the default `Q128.128 @ m` machine:

- 1 meter is exactly representable
- 1/2 meter is exactly representable
- 1/4 meter is exactly representable
- 1/8 meter is exactly representable
- 1 millimeter is not exactly representable
- 1 centimeter is not exactly representable
- 0.1 meter is not exactly representable

This is valuable because the intuitive metric machine is still fundamentally binary.

**Machine base unit and display unit are separate controls.** Switching a display from meters to kilometers must not alter state. Switching the machine from `Q128.128 @ m` to `Q128.128 @ km` creates a different representation and should visibly change range/resolution.

---

# 3. Time representation

A useful option is to store the fourth spacetime coordinate as **ct** rather than raw seconds.

```text
X/Y/Z = configured length base unit (meters by default)
CT    = the same configured length base unit
```

where:

```text
ct = speed_of_light × time
```

Because the speed of light is exactly:

```text
299,792,458 m/s
```

in SI, the conversion is unusually clean.

This gives all four coordinates the same physical dimension and makes the 1024-bit spacetime register geometrically homogeneous. The configured base unit may be mm, m, km, etc.; the default remains meters.

The UI can still display time in whichever form the user prefers:

```text
seconds
light-distance
Planck time
```

Storage does not need to change.

---

# 4. Numerical representations to compare

Every numerical experiment should be capable of running through multiple representations simultaneously.

At minimum:

```text
ExactReference (unbounded exact rational truth)
Planck-grid integer representation
Q128.128 configurable-base-unit fixed-point representation
IEEE-754 binary64
Q512.512 finite 1024-bit error accumulator attached to each simulated representation
```

The exact reference and the 1024-bit error accumulator are deliberately different concepts. The exact reference is not a finite machine.

Potential future addition:

```text
Decimal fixed-point representation
```

The purpose is not to teach:

> Floating point is bad.

The deeper lesson is:

> Every finite numerical representation chooses which numbers are convenient.

---

# 5. Exact reference arithmetic

Do not use JavaScript `Number` as the authoritative internal representation.

Use exact rational arithmetic for v0 reference values. Keep this `ExactReference` separate from every finite simulated machine and from the Q512.512 error meter.

Useful internal forms include:

- `BigInt`
- exact rational values
- arbitrary precision decimal
- arbitrary precision binary

A binary64 value can be decoded into its exact binary rational value.

This allows the application to compare:

```text
mathematical intent
vs.
exact value stored by binary64
```

without approximating the approximation.

Example:

```text
User enters:
0.1 m

Mathematical value:
1 / 10 m

binary64 stored value:
0.10000000000000000555...

Error:
+5.55... × 10^-18 m
```

That same error can then be expressed as:

```text
meters
nanometers
femtometers
Planck lengths
ULPs
relative error
```

---

# 6. Error tracking

Do not keep only one signed "total error" value because errors can cancel.

Track at least **for each simulated representation**:

```text
simulated result
exact reference result

current divergence
operand encoding error
operation rounding/quantization error
cumulative absolute event error by category
relative error
binary64 neighbor gaps / explicitly defined ULP-style metrics
```

Each numerical system should maintain its own independent state and its own ErrorLedger.

That makes it possible to watch them drift apart over a sequence of operations.

---

# 7. Numerical drift experiments

The app should include interactive numerical torture tests.

## Repeated increments

```text
Start at 0
Add 1 mm
Repeat 1,000,000 times
```

The machine must execute all one million additions. The trace should be compact: retain selected checkpoints and exact final statistics instead of allocating one heavyweight record per iteration.

Expected mathematical result:

```text
1000 m
```

Compare:

```text
Exact
Planck-grid
Q128.128
binary64
```

---

## Large-offset loss of significance

```text
+ 1e20 m
+ 1 mm
- 1e20 m
```

This demonstrates that binary64 can lose a small displacement when the local neighboring representable-value gap is much larger than the added quantity.

A fixed-point machine behaves differently because its resolution is constant for a chosen base-unit configuration.

## Floating-origin / rebasing demonstration

Start with two locations separated by 1 mm around a very large origin, for example `1e20 m`.

Show two strategies side-by-side:

```text
absolute binary64 coordinate
large origin + small local binary64 coordinate
```

The point is not merely that finite precision fails. It is to show how real software can preserve useful local precision by changing coordinate strategy.

For rendering, subtract the exact/domain camera origin before converting the small local delta to a JavaScript number.

---

## Decimal fractions

```text
(1 / 10) × 10
```

or:

```text
1 / 3
+ 1 / 3
+ 1 / 3
```

Compare the behavior of binary, decimal, rational, and fixed-point systems.

---

## Repeated transforms

Future experiments could include:

- repeated rotations
- integration of velocity
- accumulated position updates
- repeated scaling
- subtraction of nearly equal numbers
- orbital-style iterative calculations

A playful UI label could be:

> Abuse the Computer

---

# 8. Drift visualization

The visual comparison should show all representations initially occupying the same apparent position.

Example:

```text
                         exact
                          |
Planck -------------------●
Q128 ---------------------●
double -------------------●
```

Then provide:

> ZOOM TO DISAGREEMENT

As the camera zooms in, the numerical representations visibly separate.

Example:

```text
      Planck       Exact/Q128       double
         |              |             |
---------●--------------●-------------○---------
```

The UI should clearly indicate when separation has been magnified for visibility.

Example:

```text
Displaying numerical error at 10^18× magnification
```

This prevents the visualization from implying that the physical error is large at the original scale.

---

# 9. Floating-point microscope

The numerical microscope should let the user inspect the actual lattice of representable values.

Question:

> What numbers can this computer see here?

For Q128.128, representable spacing is constant:

```text
---|---|---|---|---|---
  -2  -1   0   1   2
      × 2^-128 m
```

Move far from zero and the spacing remains unchanged.

For binary64, representable values spread farther apart as magnitude increases.

Conceptually:

```text
●----------------●----------------●
```

This should make fixed point vs. floating point understandable visually before the user understands mantissas and exponents.

---

# 10. Scale Atlas

The Scale Atlas is a logarithmic view.

Equal screen distance represents equal orders of magnitude.

Example:

```text
10^-9       10^-6       10^-3        10^0         10^3
 nm           µm           mm           m            km
 |------------|------------|------------|------------|
```

Objects from very different scales can coexist.

Examples:

```text
atom
bacterium
red blood cell
ant
human
building
mountain
Earth
Sun
Solar System
observable universe
```

The atlas is for answering:

> What order of magnitude is this?

---

# 11. Engineering notation

Favor engineering notation as the default human-readable scale language.

Use powers of `10^3`:

```text
10^-12 m   pm
10^-9 m    nm
10^-6 m    µm
10^-3 m    mm
10^0 m     m
10^3 m     km
10^6 m     Mm
10^9 m     Gm
```

Display modes could include:

## Engineering

```text
7.5 µm
3.2 mm
1.7 km
```

## Scientific

```text
7.5 × 10^-6 m
3.2 × 10^-3 m
1.7 × 10^3 m
```

## Raw

```text
0.0000075 m
0.0032 m
1700 m
```

## Planck

```text
~4.64 × 10^29 lP
```

## Intuitive comparison

```text
roughly 10 red blood cells
about 4 coconuts
0.00000000018 Earths
```

---

# 12. Metric Ruler view

The ruler is different from the logarithmic atlas.

It should be **locally linear** and preserve true relative size.

The camera can still zoom exponentially, but objects within the viewport retain real scale relationships.

This enables experiments such as:

> Put red blood cells end-to-end across one millimeter.

A typical red blood cell is roughly several micrometers wide, so the app could literally render a row of cells.

At low zoom:

```text
○○○○○○○○○○○○○○○○○○○○○○○○○○...
```

Zoom out:

```text
------------------------------
```

Zoom in:

```text
○   ○   ○   ○
```

Zoom farther:

```text
red blood cell
<---- ~7.5 µm ---->
```

The purpose of this view is:

> What does the actual size difference look like?

---

# 13. Scaling background grid

The background grid should scale dynamically as the camera zooms.

The geometry of the local scene remains linear.

The **grid spacing changes logarithmically**.

Choose pleasant intervals such as:

```text
1 × 10^n
2 × 10^n
5 × 10^n
10 × 10^n
```

while emphasizing engineering-prefix transitions every three orders of magnitude.

Example:

```text
major: 1 m
minor: 100 mm
```

Zoom in:

```text
major: 100 mm
minor: 10 mm
```

Further:

```text
major: 10 mm
minor: 1 mm
```

Further:

```text
major: 1 mm
minor: 100 µm
```

The grid should feel like a CAD tool or map:

- major lines
- medium divisions
- minor divisions

As the user zooms, minor lines become major lines and new subdivisions fade into view.

No discontinuity should occur in the underlying objects.

The ruler simply reveals additional precision.

---

# 14. Progressive semantic detail

Objects should reveal additional semantic detail as the scale changes.

Example hierarchy:

```text
10 m
  human

1 m
  human body
  head
  hand

1 cm
  finger
  hair
  skin

10 µm
  skin cells
  red blood cells
  bacteria

100 nm
  viruses
  organelles
```

Zooming becomes both:

- metric navigation
- ontology navigation

---

# 15. Object graph, not a single tree

The data model should be a graph.

A coconut can simultaneously belong to:

```text
botany → fruit → coconut
food → ingredient → coconut
length scale → ~0.2 m
mass scale → ~1.4 kg
volume scale → ...
Earth objects → ...
```

Likewise, a red blood cell can belong to biological, anatomical, and size-based relationships.

The "scale tree" is just one projection of the graph.

This enables many kinds of navigation:

```text
proton
→ atom
→ molecule
→ coffee bean
→ coffee cup
→ human
→ building
→ city
→ Earth
→ Sun
```

and:

```text
Planck time
→ attosecond
→ CPU cycle
→ blink
→ heartbeat
→ day
→ lifetime
→ civilization
→ geological epoch
→ universe
```

---

# 16. Object ranges and uncertainty

Avoid fake precision.

Physical objects should normally store representative values and ranges.

Example:

```yaml
name: coconut

length:
  representative: 0.20 m
  range:
    min: 0.15 m
    max: 0.30 m

mass:
  representative: 1.4 kg
  range:
    min: 0.8 kg
    max: 2.5 kg
```

This lets the app distinguish:

- exact conversions
- measured quantities
- estimates
- representative dimensions
- natural variation

---

# 17. Comparison grammar

Comparison should be a first-class interaction.

Example:

```text
Thing A: red blood cell
Thing B: millimeter

Operation:
[end to end]
```

Result:

```text
About N red blood cells span 1 mm.
```

Another:

```text
Thing A: coconut
Thing B: building

Operation:
[end to end]
```

Or:

```text
123 × coconut
```

Then ask which physical dimension matters:

```text
Length
Mass
Volume
Area
```

Future dimensions:

```text
energy
momentum
time
power
density
```

The UI should make dimensional meaning explicit instead of treating all counts as equivalent.

---

# 18. Bit-width calculator

Make bit width a first-class feature.

Examples:

> How many bits are required to represent the observable universe at Planck resolution?

> How many bits are required to represent Earth at atomic resolution?

> How many bits are required to represent a human lifetime in CPU cycles?

Inputs:

```text
Range
Resolution
Signed / unsigned
Number of dimensions
```

Outputs:

```text
required integer states
required bits
engineering notation
comparison to common machine widths
```

Useful comparison widths:

```text
8
16
32
64
128
256
512
1024
```

The 1024-bit representation should act as a playful benchmark.

---

# 19. Renderer architecture

Use a web-first architecture.

Do not attempt to cross-compile Three.js into Godot.

Share the **data model**, not the renderer.

Conceptually:

```text
                    Scale / Quantity Core
                           |
                    Scale Object Graph
                     /             \
              Browser renderer    Godot adapter
               /          \
          Native SVG     Three.js
```

---

# 20. SVG-first browser renderer

Use native browser SVG for most of the application.

Benefits:

- scalable paths
- DOM-native interaction
- text
- groups
- event handling
- metadata
- hyperlinks
- CSS
- lightweight 2D composition
- natural compatibility with icon libraries

The majority of the Scale Atlas and Metric Ruler experience should not require a 3D engine.

---

# 21. Three.js as an optional second renderer

Use Three.js only where actual 3D adds meaningful information.

Possible uses:

- spatial relationships
- extruded SVG silhouettes
- orbital systems
- camera travel
- light-cone visualization
- molecular structures
- 3D astronomical relationships
- transitions from flat scale comparison into spatial scenes

Principle:

> SVG for comparison. Three.js for spatial experience.

---

# 22. Godot compatibility

Godot can be a future consumer of the same catalog and quantity engine.

Do not make Godot part of the core web rendering stack.

Instead expose shared data through portable forms such as:

```text
JSON
JSON-LD
SQLite
REST
local package/module
```

A Godot adapter can later consume the same object graph.

---

# 23. Noun Project integration

The Noun Project can be an optional SVG asset source.

Do not make it authoritative for the physical data.

Example object:

```yaml
name: coconut

dimensions:
  length: ...

visual:
  provider: noun-project
  icon_id: ...
  attribution: ...
```

The object model should allow other providers:

```text
Noun Project
OpenMoji
Wikimedia
custom SVG
local icon packs
procedurally generated shapes
no visual
```

The project should remain self-hostable even without access to any external icon provider.

---

# 24. Canonical quantity storage

Avoid prematurely converting all values to JavaScript binary64.

A physical quantity could be stored conceptually as:

```yaml
value: "1.616255"
exponent: -35
unit: "m"
```

or as an exact rational where appropriate.

The numerical engine can then produce representation-specific values on demand.

This preserves the ability to answer:

```text
How many Planck lengths is this?
How many bits are required?
What does binary64 store?
What does Q128.128 store?
What error was introduced?
```

---

# 25. Suggested v0

Keep the first useful version small.

## Core content

Approximately **20–30 curated objects** spanning:

```text
Planck scale
subatomic
atomic
molecular
biological
human
architectural
planetary
stellar
astronomical
observable universe
```

## Core interactions

- infinite logarithmic scale atlas
- locally linear metric ruler
- engineering-notation grid
- SVG silhouettes
- click any two objects to compare
- arbitrary counts such as `123 × coconut`
- "how many X fit across Y?"
- exact vs estimated vs range
- space mode
- time mode
- bit-width calculator
- Planck-LSB mode
- Q128.128 configurable-base-unit mode
- binary64 mode
- ExactReference inspector
- Q512.512 error-meter inspector
- numerical drift experiments
- zoom to disagreement
- floating-origin/rebasing demonstration
- versioned shareable URLs for experiments/comparisons/camera state

## Not required for v0

- full 3D
- mass
- momentum
- relativity simulation
- orbital mechanics
- Godot integration
- huge live external asset catalog

Those can be added after the interaction model proves itself.

---

# 26. Project thesis

The project is not just another "Scale of the Universe" visualization.

Its core idea is:

> **Scale, representation, and precision are different things.**

A number can be:

- physically tiny
- numerically huge
- exactly representable in one system
- impossible to represent exactly in another
- visually indistinguishable at one zoom level
- many quadrillions of Planck lengths apart at another

The same error can simultaneously be:

```text
negligible at human scale
tiny in meters
huge in Planck lengths
one ULP
```

The application should let people move fluidly between those interpretations.

---

# 27. Guiding personality

The project should be rigorous without being solemn.

Useful recurring ideas:

> We have an irresponsible amount of coordinate space.

> Zoom to disagreement.

> What numbers can this computer see here?

> Abuse the Computer.

> How many coconuts is that?

The goal is to make numerical scale intuitive through direct manipulation, absurd comparisons, and visible computational failure rather than through equations alone.


---

## Implementation companion

See `CLAUDE.md` and the files under `docs/` for concrete Claude Code implementation instructions. `docs/NUMERICS.md` is the single source of truth for machine semantics. Where this conceptual spec is ambiguous, preserve its intent and use the implementation documents for v0 decisions.
