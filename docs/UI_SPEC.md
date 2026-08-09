# UI / Interaction Specification

## Main views

The app has five primary lenses.

### 1. Scale Atlas

Purpose:

> What order of magnitude is this?

Horizontal logarithmic scale.

Equal screen distance corresponds to equal log10 change in physical size.

Example:

```text
10^-9       10^-6       10^-3        10^0        10^3
 nm           µm           mm           m           km
 |------------|------------|------------|-----------|
```

Object markers should cluster/declutter when too dense.

Clicking an object selects it and allows jumping to Ruler view centered on it.

---

### 2. Metric Ruler

Purpose:

> What does the actual size difference look like?

Locally linear coordinate system with true relative scale.

Zoom can span enormous ranges, but local object geometry remains linear.

Example red blood cell comparison:

```text
○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ...
```

At lower zoom the cells may collapse into an aggregate strip.

At higher zoom individual silhouettes appear.

---

### 3. Comparator

Purpose:

> How many X make Y?

Example controls:

```text
A: red blood cell
B: 1 millimeter
operation: end-to-end
```

Output:

- ratio;
- approximate count;
- exact/representative qualifier;
- optional visual fill.

Support arbitrary count expressions:

```text
123 × coconut
```

but require the user to choose a meaningful dimension/operation.

---

### 4. Numerical Microscope

Purpose:

> What numbers can this representation see here?

Visualize local representable-number lattice.

For Q128.128, expose **machine base unit** separately from display unit. Useful presets: mm, m, km.

Q128.128:

```text
--|--|--|--|--|--
```

spacing remains constant.

binary64:

```text
●--------●--------●
```

spacing changes with magnitude.

Controls:

- representation;
- reference value;
- zoom to adjacent representable values;
- show raw bits;
- show exact decoded rational;
- show `gapBelow` and `gapAbove`;
- show a clearly defined ULP-style value only when useful;
- show Q machine base unit, physical LSB, and physical range.

---

### 5. Representation Lab

Purpose:

> Run the same calculation through several computers and watch them disagree.

Rows:

```text
Exact
Planck
Q128.128 @ selected base unit
binary64
Q512.512 error meter (per representation)
```

Timeline of experiment operations. Long repeats show progress/checkpoints rather than rendering one million rows.

Error details should distinguish **operand encoding** from **operation rounding/quantization** when expanded.

Provide:

> ZOOM TO DISAGREEMENT

This centers the local ruler on the smallest scale at which current representations visibly separate.

Always disclose magnification:

```text
Numerical separation magnified 10^18× for visibility
```

Include a compact fixed-point comparison panel:

```text
Same 256 bits. Pick your ruler.
Q128.128 @ mm   range: ...   LSB: ...
Q128.128 @ m    range: ...   LSB: ...
Q128.128 @ km   range: ...   LSB: ...
```

Include a floating-origin/rebasing preset that shows a lost small absolute displacement becoming visible again when represented locally.

---

# Grid behavior

The Ruler background grid is locally linear but changes spacing as zoom changes.

Use pleasant spacings:

```text
1 × 10^n
2 × 10^n
5 × 10^n
```

Target roughly 80–140 px between major divisions.

Both pannable views set `touch-action: none`, which takes the browser's own
pinch away. That is the right call — the camera is the app's, not the page's —
but it makes implementing the gesture mandatory rather than optional. A
touchscreen has no wheel and no keyboard, so a view that suppresses pinch and
does not replace it cannot be zoomed at all.

A pixel means a CSS pixel on the screen in front of the reader, not a unit of
some nominal design width. Every view that states a figure in pixels — grid
spacing, level of detail, "below a pixel here", the Atlas's minimum marker
spacing — measures the element it is drawn into and sizes its `viewBox` so that
one viewBox unit is one CSS pixel. A fixed `viewBox` scaled by CSS `width="100%"`
makes all of those statements false at every width but one, which for this
project is the same defect as misreporting a number.

Consequently the camera stores a scale (metres per pixel), never a span. Two
readers at different window widths see the same scale and different amounts of
the scene, and a shared link reproduces the sender's scale exactly rather than
their window.

Subdivisions fade in/out continuously where practical.

Engineering-prefix boundaries should be easy to recognize:

```text
nm → µm → mm → m → km → Mm
```

Do not make the physical scene jump when grid units change.

---

# Camera model

Maintain a camera independent of displayed units.

Suggested conceptual state:

```ts
interface LinearCamera {
  centerMetersExact: Rational;
  metersPerPixelLog10: number;
}
```

The camera zoom exponent can use a normal double because it is display state, not an authoritative physical quantity.

For geometry, **subtract the exact/domain camera origin first**, then convert only the bounded local delta to screen numbers. Add a regression test around `1e20 m` with a 1 mm separation.

Never subtract two universe-scale JavaScript doubles to discover a micrometer difference.

---

# Progressive semantic detail

Objects can reveal related structures as zoom increases.

Example:

```text
human
  → hand
  → finger
  → skin
  → cell
```

This is graph traversal driven by scale, not a hard-coded single tree.

---

# Display modes

Quantity display toggle:

- Engineering
- Scientific
- Raw SI
- Planck
- Representation raw bits

Engineering is default.

---

# Error presentation

Always pair scary-looking counts with a physical interpretation.

Example:

```text
Error:
5.55 × 10^-18 m
≈ 3.4 × 10^17 Planck lengths
```

Do not imply that "many Planck lengths" necessarily means a practically significant error.

Allow side-by-side expressions specifically to teach this distinction.

---

# Shareability

v0 includes a visible **Share this view** action. It produces a versioned URL that can restore the selected lens, objects/experiment, representation configuration, and camera state without a backend.

A discovered numerical failure should be sendable as a link, not as reproduction instructions.

The address bar is displayed state, and is held to the same standard as any
number on screen: it must describe what is on it, or describe nothing.

- The app follows the fragment whenever it changes, not only at load. Back and
  forward between two shared views are same-document navigations, and a screen
  that does not follow them is showing one view under the URL of another.
- An unreadable fragment reports itself and changes nothing, on a cold load and
  on a later one alike. Never half-load a link.
- The fragment is cleared as soon as the view moves on from what it describes.
  A stale fragment claims a reload would bring you back here, and it would not.
  The link survives in the share field, labelled as the view it is of.

# Tone

Precise, playful, not childish.

Suitable UI phrases:

- Zoom to disagreement
- Abuse the Computer
- What numbers can this computer see here?
- 123 coconuts
- We have an irresponsible amount of coordinate space

Avoid overwhelming the user with notation until they ask for it.
