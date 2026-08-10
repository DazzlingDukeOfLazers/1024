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
  /** Required when an object has more than one length. See below. */
  primary?: boolean;
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
    minMeters?: string;
    maxMeters?: string;
  };
}
```

The concrete code may evolve, but keep the following principles.

### Implemented deviation: value literals

The loader accepts an exact value written **either** as `{ "numerator", "denominator" }` **or** as a plain string — `"7.5"`, `"1.616255e-35"`, `"3/20"`. Both parse to the same exact rational.

Hand-authoring `7.5 µm` as a fraction of metres is a transcription bug waiting to happen, and nothing about exactness depends on which form is written. Fixture authors should also prefer a natural unit (`"unit": "µm"`, `"representative": "7.5"`) over restating everything in metres; the loader converts exactly.

## Principles

### Implemented deviation: `semanticDetail` is a size window, not a resolution

`semanticDetail` was declared as `minMetersPerPixel`/`maxMetersPerPixel` and read
as though it were a range of object sizes. Those are different quantities: a
scale band is a window of sizes — the Atlas builds one from its visible extent,
and everything tested against it is an object's own magnitude — while metres per
pixel is a camera resolution, related to it only through the viewport width. A
fixture that had used the field would have been placed by a factor of the
viewport away from where it asked to be.

The fields are `minMeters` and `maxMeters` now. **No fixture sets one**, and
that is the honest state rather than an omission: the derived band — a couple of
decades either side of the object's own size — is where a thing is neither a dot
nor larger than the view, and the progressive-detail panel does better still by
taking the band from the camera rather than from any declaration. The field
exists for an editorial opinion nobody has yet had.

### An object with two lengths must say which one it *is*

The Atlas places an object at a single position, the Ruler draws it to scale and
the Comparator compares it, and all three ask for one number. With one length
there is nothing to choose. With two there is, and it was being chosen by JSON
key order — `primaryLength` returned whatever `Object.values` came to first — so
the size three lenses present as the size of the thing would have been decided
by which key its author happened to type above the other.

Mark exactly one length `primary: true`. `createCatalog` refuses an object with
several lengths and none marked, or with more than one marked, at load: the app
does not start rather than start with a number nobody chose. Objects with a
single length need no flag, which is twenty-seven of the twenty-eight.

A view that shows the primary length should say it is the primary one when
there are others. The Atlas's selection panel reads `placed by its height; also
width 800 mm` — the marker stands at one number and the object is not only that
number.

### Author one direction of a relation, never both

The graph derives the inverse of every authored edge, so `contains` in one
object implies `contained by` in the other. A fixture that also writes the
reverse by hand turns one fact into two edges, and every view that lists
neighbours lists that object twice — under two different words if the two
directions were given different types, which is what
`hydrogen-atom part-of water-molecule` and `water-molecule made-of hydrogen-atom`
did.

`createCatalog` therefore refuses more than **one authored relation per
unordered pair**, and refuses a relation from an object to itself. The rule is
deliberately stronger than "not the same type twice": two types between the same
pair is the worse case, not a lesser one.

The fixture authors 18 relations, of which 18 point from the smaller object to
the larger — `part-of`, `within`, `orbits`. Before the rule was enforced it was
18 of 20, and the two exceptions were exactly the two duplicates: in both cases
the redundant edge was the one pointing from the larger object down. So the
convention was not invented to resolve them, it was measured and then applied.

A view that lists relations alongside objects found by scale alone must also
subtract the first list from the second. "Unrelated to the selection" is a
claim, and an object named in both tables makes it false.

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

v0 fixtures may use clearly marked demonstration values while the data pipeline is being built. The marking is the `approximation` kind, not a string in the `source` field:

- `exact` and `measured` are claims a reader could go and check, so **the schema refuses them without a source**. `parseScaleObject` throws.
- `representative` and `estimated` claim nothing checkable. An **absent** source is the honest way to say so.
- A placeholder written into `source` — `"demonstration value"`, `"TBD"`, `"unknown"` — is **rejected**. It reads like a citation in every list and table that displays it, and is not one.

Every view that shows a curated number must also show `provenanceSummary(quantity)`, which produces one sentence for both cases: `"Measured. WGS 84 reference ellipsoid…"` or `"A representative figure. No source recorded — a plausible figure chosen to make the scale legible, not traceable to a citation."` A number displayed without it is presented with the same certainty as a defined constant, which is the thing this schema exists to prevent.

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
area-ratio
volume-ratio
how-many-fit-volume
```

Area and volume must use appropriate geometry rather than blindly reusing length ratios — and for two objects that share nothing but a length, the geometry that applies is **similarity**. For the same shape at different sizes, areas go as the square of any corresponding length and volumes as the cube, exactly, whatever the shape is: the shape factors cancel in a ratio. No shape factor is invented, and none is needed.

What does not cancel is the similarity itself, and the catalog does not know it. So `area-ratio` and `volume-ratio` carry an `assumes` field, and every view that shows one must show it — the arithmetic is exact and the claim is conditional, which are different things. `assumes` is deliberately not merged into `approximateBecause`: that field is about how well the inputs are known, and two exactly defined lengths still do not make a house the same shape as a coconut.

`how-many-fit-volume` needs a third thing: a **packing model**. Spheres do not tile, so the volume ratio is not the count — it overstates it by more than half. This operation was deliberately absent while there was no citable number for the shortfall, and it exists now because there is one, measured rather than chosen: equal spheres poured into a large container and shaken down occupy 0.6366 ± 0.0005 of it (Scott and Kilgour 1969). That is not a rounding of the theoretical maximum; the densest arrangement equal spheres can reach is π/√18 ≈ 0.7405, and pouring does not get there. Two numbers, two questions, and "how many fit in here" takes the poured one.

The fraction is a declared constant with provenance, in the shape `src/core/representations/constants.ts` uses and deliberately outside `CODATA_2018` — that set is what a simulated machine's grid is conditioned on, and a packing fraction has nothing to do with a register. Its own ±0.0005 stays out of the result's `range`, which carries uncertainty in the *inputs*; uncertainty in the model belongs with the assumption that names it.

Three assumptions is more than one, so the view lists them rather than joining them into a sentence — each can be rejected on its own, and joined with "and" the citation ran straight into the wall condition.

A view that draws a comparison must also say when the picture is not the answer. The strip compares *lengths*, because a length is the one dimension the catalog holds, so for the three operations that raise that comparison to a power the picture and the headline are different numbers — 133 across a millimetre, 2,370,000 through it. A reader is entitled to assume the picture is the answer unless told otherwise.

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

## Provenance status of the v0 fixture

`fixtures/objects.json` holds 28 objects spanning ~10^-35 m to ~10^27 m.

Eleven are backed by a citation:

| object | claim | source |
| --- | --- | --- |
| astronomical unit | exact | IAU 2012 definition |
| light-year | exact | IAU: the speed of light times a Julian year |
| Planck length | measured | CODATA 2018, with the published standard uncertainty as the range |
| proton | measured | CODATA 2018 proton rms charge radius 0.8414(19) fm, doubled |
| Moon | measured | NASA planetary fact sheet, volumetric mean radius 1737.4 km, doubled |
| Earth | measured | WGS 84 reference ellipsoid; mean radius 6371.0 km, doubled |
| Sun | measured | IAU 2015 Resolution B3 nominal solar radius 6.957e8 m, doubled |
| hydrogen atom | representative | twice the Bohr radius (CODATA 2018), with the Bondi van der Waals diameter as the upper bound |
| coconut | representative | PROJECT_SPEC.md section 16 |
| DNA double helix | representative | Arnott & Hukins 1972 B-DNA fibre-diffraction parameters; 20.4 Å via BioNumbers BNID 105243 |
| Solar System | representative | twice Neptune's semi-major axis, 30.07 au (NASA planetary fact sheet) |

The last four are `representative` and did not need a source; having one is better than not, and says where a chosen number was chosen from. Note what those sources do and do not claim: an atom, a helix and a solar system all have no edge, so the citation names the *convention* — twice the Bohr radius, the fibre-diffraction width, twice Neptune's semi-major axis — rather than asserting a measured boundary. That is why they stay `representative` while carrying a reference.

The remaining 17 are `representative` or `estimated` **with no source**, which is what they are: curated, plausible, deliberately round, and not traceable to a citation. Every lens that shows one says so, in the same words.

Four of the nine — the proton, the Moon, the Earth and the Sun — previously claimed `approximation: "measured"` while carrying `source: "demonstration value"`. That is a contradiction, because a measurement with no citation is not a measurement. The schema now rejects the combination outright, so the fixture cannot drift back into it.

Replacing the remaining 19 is a data task, not a code task: the schema, the range handling and the exact/approximate wording all work already. Tests assert that no object outside the two definitions claims to be exact, that every `exact` or `measured` quantity is cited, and that no source is a provenance status in disguise.
