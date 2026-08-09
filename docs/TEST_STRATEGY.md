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

---

# Visual regression

Once UI stabilizes, add screenshots for:

- atlas at several decades;
- ruler at m/mm/µm scales;
- collapsed vs individual RBC rendering;
- representation-lab disagreement view.

Do not lock visual snapshots too early.
