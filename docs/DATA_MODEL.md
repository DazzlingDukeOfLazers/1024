# Data Model

## Object graph

The catalog is a graph, not a single hierarchy.

One object may participate in several relationships.

Example:

```text
coconut
├─ botany / fruit
├─ food / ingredient
├─ length scale
├─ mass scale (later)
└─ visual asset relationships
```

## Initial schema

```ts
type DimensionKind = "length" | "time";

interface ExactRationalJSON {
  numerator: string;
  denominator: string;
}

interface QuantityValue {
  dimension: DimensionKind;
  unit: string;
  representative: ExactRationalJSON;
  range?: {
    min: ExactRationalJSON;
    max: ExactRationalJSON;
  };
  approximation: "exact" | "measured" | "representative" | "estimated";
  note?: string;
  source?: string;
}

interface VisualAsset {
  provider: "bundled" | "noun-project" | "openmoji" | "wikimedia" | "custom";
  id?: string;
  path?: string;
  attribution?: string;
}

interface ScaleObject {
  id: string;
  name: string;
  aliases?: string[];
  quantities: Record<string, QuantityValue>;
  categories: string[];
  relations?: {
    type: string;
    targetId: string;
  }[];
  visuals?: VisualAsset[];
  semanticDetail?: {
    minMetersPerPixel?: string;
    maxMetersPerPixel?: string;
  };
}
```

The concrete code may evolve, but keep the following principles.

## Principles

### Separate identity from visuals

`red-blood-cell` remains the same object if its SVG provider changes.

### Separate representative size from exact conversion

A millimeter is exactly defined.

A red blood cell diameter is a representative physical measurement/range.

The UI must not present these with the same certainty.

### Store ranges

Do not reduce naturally varying objects to false exact values.

### Store provenance

Every curated physical quantity should eventually include enough provenance to answer "where did this number come from?"

v0 fixtures may use clearly marked demonstration values while the data pipeline is being built.

### Allow multiple dimensions later

Do not architect length so deeply into object identity that adding mass/volume becomes a rewrite.

But do not build mass/volume now.

---

## Declared constants and numerical provenance

Physical constants used by numerical machines are separate from catalog object measurements.

For Planck conversion, keep a declared nominal value plus source/version/precision/uncertainty metadata. Numerical quantization is computed **given that nominal declaration**; measurement uncertainty is not added to the representation error ledger.

## Share-state model

v0 has a versioned, backend-free share-state schema. It should be able to encode:

- current lens;
- selected catalog IDs / comparison operation;
- experiment ID or serializable experiment definition;
- representation configuration, including Q128.128 machine base unit;
- camera state;
- display mode when it affects interpretation.

All BigInts/rationals remain string-encoded.

# Comparison operations

Operations belong to dimensions.

Initial length operations:

```text
end-to-end
how-many-fit
difference
ratio
```

Future area/volume operations must use appropriate geometry rather than blindly reusing length ratios.

Example request:

```text
123 coconuts
```

is incomplete until a dimension/operation is selected.

Possible interpretation:

```text
123 coconuts end-to-end
```

Do not pretend count has an intrinsic length.

---

# Initial fixture objects

Start small and deliberately span many orders of magnitude.

Suggested set:

- Planck length
- proton
- hydrogen atom
- DNA helix width
- representative virus
- bacterium
- red blood cell
- human hair
- grain of sand
- ant
- coconut
- human
- door
- house
- skyscraper
- Chicago-scale city extent
- Earth
- Moon
- Sun
- AU
- Solar System proxy
- light-year
- Milky Way
- observable-universe radius

Use 20–30 objects first, not 500.

The first objective is to prove navigation and comparison behavior.
