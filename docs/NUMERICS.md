# Numerical Model — Source of Truth

This document is the **single source of truth for numerical representation semantics** in Scale Atlas.

Other documents should explain goals, UI, or implementation order without redefining these machines. If another document conflicts with this file, update the other document in the same change.

---

# 1. ExactReference: authoritative mathematical intent

For v0, mathematically rational quantities use a normalized exact rational:

```ts
interface Rational {
  numerator: bigint;
  denominator: bigint; // always > 0
}
```

Normalize by GCD.

`ExactReference` is unbounded mathematical/reference arithmetic. It is **not a 1024-bit machine** and must never be called an "exact 1024-bit shadow."

Canonical SI quantities use exact rationals whenever the source or unit conversion supports exactness.

Do not force measured or irrational physical constants into fake exactness. Preserve a declared nominal value, provenance, precision, and uncertainty metadata where relevant.

---

# 2. Finite signed integer semantics

JavaScript `BigInt` is implementation storage, not simulated width.

For signed width `W`:

```text
min = -2^(W-1)
max =  2^(W-1) - 1
```

Provide:

- `fitsSigned(width, value)`
- `wrapSigned(width, value)`
- `clampSigned(width, value)`
- checked arithmetic returning an overflow event

Default educational behavior: **checked overflow**.

Wrapping and saturation may be selectable for demonstrations, but must never occur silently.

---

# 3. Declared physical constants

Physical constants used by a simulated machine are declared inputs, not mathematical truths manufactured by the application.

Use a structure conceptually like:

```ts
interface DeclaredConstant {
  id: string;
  nominal: Rational;          // decimal declaration encoded exactly as a rational
  unit: string;
  source?: string;
  sourceVersion?: string;
  declaredDigits?: number;
  uncertainty?: {
    kind: "absolute" | "relative";
    value: Rational;
  };
}
```

For the Planck machine, freeze one nominal Planck length and Planck time declaration for a given experiment/version.

**Numerical representation error is conditioned on that chosen nominal constant.** Do not mix the physical constant's measurement uncertainty into the machine's quantization/error ledger.

The UI may explain both, but they are separate concepts:

```text
physical/model uncertainty != numerical representation error
```

---

# 4. PlanckInt256 spacetime machine

Four 256-bit signed integer registers:

```text
X/Y/Z raw unit = declared nominal Planck length
T raw unit     = declared nominal Planck time
```

Total register width: 1024 bits.

Encoding SI quantities into Planck ticks requires quantization relative to the chosen nominal constants.

The machine's educational purpose is bit width and fixed absolute resolution. It does **not** assert that spacetime is physically discrete.

---

# 5. Q128.128 metric spacetime machine

Each coordinate is a signed 256-bit fixed-point register with 128 fractional bits.

The **machine base unit is configurable** and is distinct from the UI display unit.

Let `B` be an exact rational number of meters per machine unit:

```text
decoded SI meters = raw × B / 2^128
```

Examples:

```text
Q128.128 @ mm : B = 1/1000 m
Q128.128 @ m  : B = 1 m      (default)
Q128.128 @ km : B = 1000 m
```

Changing `B` changes the simulated machine:

- smaller base unit -> finer absolute resolution, smaller physical range;
- larger base unit -> coarser absolute resolution, larger physical range.

Changing only the **display unit** must never change machine state.

For the default `Q128.128 @ m` machine:

```text
1 m      exact
1/2 m    exact
1/4 m    exact
1/8 m    exact

1 mm     quantized
1 cm     quantized
0.1 m    quantized
1/3 m    quantized
```

For spacetime, X/Y/Z use the configured length base unit. The default fourth coordinate is `ct`, using the same length base unit.

Quantization policy must be explicit.

Initial policy:

- round-to-nearest;
- ties-to-even where practical.

Selectable truncate/floor/ceil modes may be added for demonstrations.

Suggested configuration type:

```ts
interface Q128_128Config {
  baseUnitMeters: Rational;
  baseUnitLabel: string; // e.g. "mm", "m", "km"
  rounding: "nearest-even" | "truncate" | "floor" | "ceil";
  overflow: "checked" | "wrap" | "saturate";
}
```

---

# 6. Q512.512ErrorAccumulator: finite 1024-bit error meter

The finite error meter is a signed 1024-bit Q512.512 register:

```text
decoded = raw / 2^512 canonical SI units
```

This is a **finite simulated machine**, not the exact reference.

Each primary simulated representation owns its own `ErrorLedger`. The UI may emphasize binary64 first, but do not implement one global error bucket shared by all machines.

Keep exact ledger totals and finite error-meter totals side-by-side so the error meter's own quantization/overflow can be observed.

Conceptually:

```ts
interface ErrorLedger {
  currentSignedDivergence: Rational;
  currentAbsoluteDivergence: Rational;
  currentSignedInheritedPropagation: Rational;

  exactRawOperandEncodingDelta?: Rational;
  exactSignedOperandEncodingContribution: Rational;
  exactAbsoluteOperandEncodingContribution: Rational;

  exactSignedOperationRoundingError: Rational;
  exactAbsoluteOperationRoundingError: Rational;

  cumulativeAbsoluteOperandEncodingContribution: Rational;
  cumulativeAbsoluteOperationRoundingError: Rational;

  q512_512SignedAccumulator: FixedPointState;
  q512_512AbsoluteAccumulator: FixedPointState;
}
```

The exact cumulative event totals are diagnostics. They are not expected to equal current divergence because errors can cancel or be amplified by later operations.

---

# 7. Error event decomposition

For exact prior state `E_prev`, represented/decoded prior state `R_prev`, exact operand `O`, represented/decoded operand `O_r`, exact new state `E_new`, and represented/decoded new state `R_new`, keep the decomposition in the **output quantity's unit**.

### Raw operand encoding delta

```text
raw_operand_encoding_delta = O_r - O
```

This is useful for inspection, but for multiplication/division it may not have the same dimension as the result. Do not blindly feed this raw delta into the output error accumulator.

### Inherited/propagated divergence

Apply the exact operand to the machine's already-represented prior state:

```text
baseline_from_represented_state = exact(op(R_prev, O))
inherited_propagation = baseline_from_represented_state - E_new
```

This answers: what divergence would remain even if the new operand were encoded perfectly and the operation itself did not round?

### Operand-encoding contribution to this result

Apply the represented operand instead:

```text
ideal_from_represented_inputs = exact(op(R_prev, O_r))
operand_encoding_contribution =
  ideal_from_represented_inputs - baseline_from_represented_state
```

This contribution is expressed in the result's unit and is suitable for the error ledger.

### Operation rounding/quantization error

```text
operation_rounding_error = R_new - ideal_from_represented_inputs
```

For fixed-point addition, an operand may be quantized while the subsequent integer addition itself is exact. That distinction is educational and must remain inspectable.

### Current divergence from mathematical intent

```text
signed_divergence = R_new - E_new
absolute_divergence = abs(R_new - E_new)
```

For ordinary deterministic operations in scope, this gives the useful decomposition:

```text
current divergence
  = inherited/propagated divergence
  + operand-encoding contribution
  + operation rounding/quantization error
```

The finite Q512.512 signed error meter accumulates the **new output-domain error contributions** introduced at each step (`operand_encoding_contribution + operation_rounding_error`). The finite absolute meter accumulates the absolute magnitudes of those new contributions by category. Exact diagnostics retain the categories separately. Cumulative introduced error is not expected to equal current divergence because prior errors can be transformed, canceled, or amplified by later operations.

Do not "repair" one representation using exact state or another representation's state.

---

# 8. Binary64 state and exact inspection

JavaScript `number` may be used only inside the binary64 simulation/inspection boundary and for bounded display calculations.

Binary64 machine state must preserve the full IEEE-754 categories:

```ts
type Binary64State =
  | { kind: "finite"; value: number; signBit: 0 | 1; exact: Rational }
  | { kind: "positive-infinity" }
  | { kind: "negative-infinity" }
  | { kind: "nan"; signBit: 0 | 1; payloadBits?: bigint };
```

For finite zero, preserve the sign bit so `+0` and `-0` remain distinguishable even though both decode numerically to rational zero.

Expose:

```text
sign bit
11-bit exponent field
52-bit fraction field
effective significand
exact rational value (finite values)
neighbor below
neighbor above
gap below
gap above
```

Use `DataView` to decode bits and construct the exact stored rational for finite values.

Do not infer the stored value by printing a decimal string and parsing it back.

Use `gapBelow` and `gapAbove` rather than assuming one symmetric "ULP spacing." Around powers of two and representation boundaries, adjacent gaps can differ. A convenience `ulp` label may be shown only when its definition is explicit.

At infinities/NaN, neighbor/gap fields may be undefined or represented as events rather than fake rationals.

---

# 9. Relative error

Where exact reference `E != 0`:

```text
relative_error = (R - E) / E
```

When `E == 0`, relative error is undefined. UI text should say `undefined at zero reference` rather than silently displaying infinity.

---

# 10. ULP-style error reporting

Avoid pretending "ULPs from exact" is always an integer concept when the exact value lies between representable values.

Useful binary64 diagnostics include:

- exact distance to neighbor below;
- exact distance to neighbor above;
- `gapBelow` / `gapAbove`;
- distance from exact intent to the selected representable result expressed relative to a clearly named local gap.

The UI should prefer concrete neighbor/gap explanations over a single ambiguous ULP number.

---

# 11. Repeat operations and trace policy

A repeated experiment such as "add 1 mm one million times" must execute the real machine operation one million times. Do **not** replace repeated addition with multiplication.

However, do not allocate one heavyweight immutable trace record per iteration by default.

Represent repetition as a first-class serializable operation:

```ts
interface RepeatStep {
  op: "repeat";
  count: number;
  step: AtomicExperimentStep;
  trace?: {
    first?: number;
    last?: number;
    checkpoints?: number[];
  };
}
```

The runner should:

- execute every iteration;
- maintain exact final statistics;
- emit/store only requested checkpoints plus final state by default;
- support streaming/chunked progress callbacks so long runs do not freeze the UI architecture;
- remain easy to move into a Web Worker without rewriting the numerical core.

---

# 12. Exact-to-render conversion

Rendering coordinates are never authoritative physical coordinates.

For a local ruler, subtract the camera origin in exact/domain arithmetic **before** converting the small render-relative delta to JavaScript `number`:

```text
deltaExact = objectPositionExact - cameraOriginExact
screenX = boundedNumber(deltaExact / metersPerPixel)
```

Never do this:

```text
Number(objectPositionExact) - Number(cameraOriginExact)
```

because a millimeter at a `1e20 m` offset can disappear before rendering even begins.

---

# 13. log10 of an exact rational

Atlas placement must not require coercing an arbitrarily huge or tiny rational into `Number` first.

Implement an exact-safe order-of-magnitude path, conceptually:

1. determine the decimal exponent/order using integer digit/bit-length comparisons on numerator and denominator;
2. normalize the rational into a bounded interval such as `[1, 10)` using exact powers of ten;
3. convert only that bounded mantissa (or a bounded approximation of it) to `number` for the fractional `log10` used by display state.

This keeps enormous physical magnitudes out of JavaScript's finite numeric range while still allowing a normal double for a bounded camera/log display coordinate.

Provide a dedicated utility such as:

```ts
log10RationalForDisplay(value: Rational): number
```

with tests proving it works for values far outside binary64's ordinary exponent range.

---

# 14. Serialization and share state

Never serialize `BigInt` as JSON numbers.

Exact values use strings:

```json
{
  "numerator": "1",
  "denominator": "1000"
}
```

Finite register state uses explicit representation metadata, for example:

```json
{
  "kind": "q128.128",
  "rawHex": "0x...",
  "signed": true,
  "integerBits": 128,
  "fractionBits": 128,
  "baseUnitMeters": { "numerator": "1", "denominator": "1" },
  "baseUnitLabel": "m"
}
```

v0 includes a **versioned shareable URL state** containing enough information to recreate a useful view/experiment:

- schema version;
- selected lens;
- experiment definition or ID;
- representation configurations;
- selected objects/comparison;
- camera state;
- display preferences that materially affect interpretation.

The URL representation may be compressed as an implementation detail, but must round-trip without numerical loss. No backend is required.

---

# 15. Engineering notation

Default display chooses SI prefixes in steps of `10^3`.

Examples:

```text
7.5e-6 m  -> 7.5 µm
0.0032 m  -> 3.2 mm
1700 m    -> 1.7 km
```

Display formatting is not storage and is not the Q128.128 machine's base unit.

Support at least:

- engineering;
- scientific;
- raw SI;
- Planck;
- intuitive/object comparison;
- representation raw bits.

---

# 16. Required numerical invariants

Property/unit tests must establish at least:

- rational normalization preserves value;
- Q decode(encode(x)) error <= 0.5 LSB for nearest-even;
- Q128.128 physical LSB equals `baseUnit / 2^128`;
- changing Q128.128 **base unit** changes physical range/resolution but not bit width;
- changing display units never changes exact or machine state;
- fixed-point spacing is constant for a fixed base-unit configuration until overflow;
- binary64 `+0` and `-0` retain distinct sign bits;
- binary64 neighbor gaps are computed independently above and below;
- exact integer values inside binary64's exact range round-trip exactly;
- finite-width wrappers never escape their specified bit width;
- repeat execution performs the requested number of machine operations even when trace storage is compact;
- camera-relative exact subtraction preserves a `1 mm` separation around a `1e20 m` origin;
- `log10RationalForDisplay` works without first coercing huge/tiny rationals to `Number`.
