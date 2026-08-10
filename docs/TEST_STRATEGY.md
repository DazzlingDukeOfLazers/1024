# Test Strategy

The numerical core is the product foundation. Rendering tests do not substitute for numeric tests.

## Unit tests

### Rational

Test:

- normalization;
- zero;
- negative numerator;
- denominator sign normalization;
- add/subtract/multiply/divide;
- comparison;
- GCD reduction;
- huge BigInt values.

### Finite-width signed integers

For widths including 8, 16, 128, 256, 1024:

- min/max;
- positive overflow;
- negative overflow;
- wrapping;
- checked mode;
- two's-complement encoding/decoding.

Small widths make exhaustive tests feasible.

### Q128.128 configurable base unit

Test exact cases for `Q128.128 @ m`:

- 0
- 1
- -1
- 1/2
- 1/4
- 1/8
- integer boundaries

Test inexact cases:

- 1/10
- 1/100
- 1/1000
- 1/3

Verify quantization <= 0.5 LSB under nearest rounding.

Test overflow edges.

Also test `@mm`, `@m`, and `@km` configurations:

- physical LSB = base unit / 2^128;
- same raw bits decode to different SI magnitudes under different configs;
- bit width remains 256;
- display-unit changes do not mutate base-unit configuration.

### Q512.512

Same structural tests as Q128.128.

Additionally test accumulation of many small signed/absolute errors.

### binary64 inspector

Known bit patterns:

- +0
- -0
- 1
- -1
- 0.5
- smallest subnormal
- smallest normal
- max finite
- +Infinity
- NaN

Verify exact rational decoding for finite values.

Verify predecessor/successor and `gapBelow`/`gapAbove` around selected values, especially exact powers of two.

Verify +0 and -0 preserve distinct sign bits. Verify finite/Infinity/NaN state categories.

---

# Experiment tests

Each built-in experiment gets a snapshot-like structural test, but avoid brittle formatted-string snapshots.

Assert exact rational states and event types.

Required:

## `0.1 + 0.2`

- exact result = 3/10;
- binary64 result differs;
- divergence is nonzero;
- UI formatter may display concise decimal but inspectable exact binary rational exists.

## Million millimeters

- exact result = 1000 m;
- execute exactly 1,000,000 machine additions;
- store compact checkpoints/final statistics rather than 1,000,000 heavyweight trace records by default;
- track operand-encoding and operation-rounding/quantization errors independently per representation;
- no accidental loop using exact state to correct simulated state.

## Large offset

`+1e20 m`, `+1 mm`, `-1e20 m`

- verify binary64 loses or alters the small increment as expected from its own representation;
- verify Q128.128 behavior is based on its configured fixed resolution, not JavaScript number conversion.

## Floating origin / rendering precision

At an exact camera origin of `1e20 m`, place two exact objects 1 mm apart.

- subtract camera origin in exact/domain arithmetic first;
- then convert the small delta to `number`;
- verify the two screen positions remain distinguishable.

Also assert that a deliberately naive `Number(absolute) - Number(origin)` path demonstrates the expected loss, without using that path in production.

## Exact-safe log10

Test atlas positioning for rationals many orders of magnitude beyond binary64 normal range.

- do not coerce the full rational to `Number`;
- verify correct decimal order;
- verify bounded fractional log result is finite and monotonic for selected fixtures.

---

# Property tests

Use generated rational inputs within safe test bounds.

Properties:

- exact rational add is associative mathematically;
- Q physical LSB follows configured base unit exactly;
- encode/decode Q error bound;
- fixed-point adjacent raw integers decode one LSB apart;
- wrapping stays in range;
- formatting + parsing of serialized exact values round-trips;
- versioned share URL state round-trips exact experiment and camera values without loss.

Do **not** assert floating-point associativity.

Use non-associativity as an experiment.

---

# UI tests

Playwright flows:

1. open atlas;
2. choose red blood cell;
3. jump to ruler;
4. select millimeter comparison;
5. zoom and verify grid label changes;
6. open Representation Lab;
7. load large-offset experiment;
8. run it;
9. click Zoom to Disagreement;
10. verify magnification disclosure appears;
11. copy share URL and restore the same experiment/camera/configuration;
12. run floating-origin demo and verify the local 1 mm separation is visible.

Prefer semantic selectors/roles.

Playwright serves the **production bundle** (`npm run build && npm run preview`),
not the dev server. React's development build is a different program: StrictMode
double-invokes effects, prop validation and jsx dev warnings dominate the render
path, and errors surface differently. Testing `npm run dev` verifies something
other than what ships. The build costs about a second.

Figures stated in pixels are held against measured DOM geometry rather than
against the code that produced them (`e2e/pixels.spec.ts`). A readout that agrees
with itself in viewBox units can be wrong on every screen at once.

## Check the core against an implementation that is not itself

Every test in this repository other than these was written by the same author as the code it tests, at the same time, holding the same idea of what the answer should be. That shape of suite catches slips and cannot catch a misconception: an author who believes ties round half away from zero writes the code and the test to agree, and both pass.

`tools/oracle.py` is a second implementation with different bugs. It uses Python's `fractions.Fraction` for exact arithmetic and `struct` for the bits of a double, and writes `fixtures/oracle.json`: 300 arithmetic cases, and roughly 390 each of order-of-magnitude, exact-decimal, binary64 encoding and neighbour cases. `src/core/oracle.test.ts` reads that fixture and compares.

The fixture is **committed**, so the comparison runs in CI with no Python installed. Regenerate deliberately with `npm run oracle`, and read the diff — a change there means one of the two implementations moved.

Python earns this job in a narrow band and is asked nothing wider:

- `Fraction` is exact rational arithmetic written by other people;
- `float(Fraction)` is correctly rounded nearest-even, the rule `encodeRational` implements by hand rather than delegating to `Number(string)`;
- `Fraction(some_float)` is the exact value of a double, which is what `exactValue` claims to produce;
- `math.nextafter` walks real neighbours.

The finite machines are covered too, which took a second look. The first version of this section said they were out of scope because Python's unbounded integers hide finiteness. That is true of an oracle that never asks and wrong as a general claim: asked out loud, unbounded integers are exactly the right tool. They quantize onto the Q128.128 and Planck grids exactly, and then report whether the result fits the width, which is a plain integer comparison — and `Fraction` still does the part that is hard to get right. The generated cases straddle every boundary: below the LSB, at exactly half an LSB where nearest-even and half-away-from-zero disagree, and past the top of each machine's range.

What is genuinely out of scope is the overflow **policy** — checked, wrapping, saturating. That is this project's design rather than a shared rule, and a second implementation of it by the same author would be evidence of nothing.

One more limit, stated where it applies: at the top of binary64's range Python declines, raising `OverflowError` rather than returning infinity, so the oracle applies the IEEE rule itself there. On that one case it asserts a rule rather than offering a second implementation of one, and the code says so at the point it does it.

Generated cases include the inputs that separate a correct implementation from a plausible one: values exactly half an ulp above a representable double, where ties-to-even and ties-away-from-zero disagree; subnormals down to 10^-310; the largest finite double and the first value past it.

## Enumerate the states; check the rules across all of them

Two failure modes accounted for nearly every defect found after the milestones were complete:

1. **a path nobody had walked** — three of the Comparator's four operations, four of the Ruler's presets, most of the Lab's experiments;
2. **a fix that was right where I was looking and missing one panel over** — bounds added to the Atlas and not the Ruler, a rounding mark added to the Comparator and not the Lab, a convention written into `docs/NUMERICS.md` and applied to one of the two places it governed.

Neither is fixed by looking harder, and both are fixed the same way. `e2e/conformance.spec.ts` enumerates the states the app can be put into — every lens, operation, preset, experiment and a spread of magnitudes — and at each one evaluates every invariant **against the whole document**:

- no two labels overlap;
- no label is cut off by the edge of its own drawing;
- no label is drawn too small to read;
- the page never scrolls sideways;
- a value under a label claiming exactness carries the formatter's verdict.

The last of these is why `Rendered` writes `data-exact` into the DOM. A rule that can only be checked by reading the digits is a rule that can be satisfied by luck; an attribute is either there or it is not, in every panel, and a new panel that drops the flag fails this file rather than waiting to be noticed.

Write these checks page-wide even when the defect that prompted them was in one place. A per-panel assertion cannot fail for the panel it was not written about, which is precisely the gap it needs to cover.

## An assertion that nothing is wrong must prove it looked

`expect(overlaps).toEqual([])` is also what an empty page says. So is "no accessibility violations", "no text below 7 px", "no file missing", "no cell unmarked". Every assertion of that shape needs a companion assertion that the collection it scanned was not empty:

- count what was examined and require a floor — `expect(boxes.length).toBeGreaterThan(1)`;
- make the floor evidence that the test looked, not a claim about how many there ought to be, or it becomes a second thing to maintain;
- for `axe`, the evidence is `results.passes` — rules run and nodes checked — not the absence of violations.

This is not hypothetical. A test written to catch a missing "rounded" mark passed on its first run by scanning an experiment whose values all render exactly: it asserted that a label was missing and found it missing. The guard turned it red, and the test was pointed at an experiment with something to be honest about.

The same reasoning applies to a matcher pattern that can never match: `keepNonOverlapping` and friends must be tested for what they keep as well as what they drop.

---

# Visual regression

`e2e/visual.spec.ts`, added once the UI shape settled and not before. The
instruction below — do not lock too early — was followed for a concrete reason:
the views were switched to measuring their own width, and then the Architecture
Lab grew four panels and two animations. Baselines taken during that would have
been re-recorded every session, which teaches everyone to run
`--update-snapshots` without looking, and that is the failure mode that makes a
visual suite worse than none.

**What it covers.** Ten curated states at 1280 and 420: one per lens, plus the
dense and mid-accumulation Architecture Lab views. Not the full state sweep —
the geometry rules in `conformance.spec.ts` already catch overlap, clipping and
off-edge labels *everywhere*, and what pixels add on top is the unintended
change: a panel that moved because something else grew. Twenty PNGs, about
3.3 MB.

The curated list is hand-maintained, so a test asserts every name in it is
still a real state in `e2e/states.ts`. Renaming a state would otherwise drop it
from the baseline set silently.

**Updating after an intended change:**

```
npx playwright test e2e/visual --update-snapshots
```

Then read the diff images in `test-results/` before committing. A baseline
updated without looking is a test deleted without saying so.

**Not on CI.** These are Windows-rendered. Fonts differ on Linux, so every
glyph moves and every baseline fails for a reason unrelated to the change under
test. The spec skips when `CI` is set; CI keeps the geometry rules, which are
portable because they assert relationships rather than pixels.

**Sensitivity.** `maxDiffPixelRatio: 0.002` — sub-pixel text rendering varies
by a hair between runs, and a hard zero would flake and train people to ignore
the suite. Verified in both directions: the baselines pass twice in a row
unchanged, and changing one table's cell padding by 0.05rem fails twenty of the
twenty-one tests.
