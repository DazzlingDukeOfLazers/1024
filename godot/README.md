# Godot scale viewer (MVP)

A second consumer of the scale catalog, as PROJECT_SPEC §22 describes: it shares
the data model with the web app, not the renderer.

Zoom from the Planck length (10⁻³⁵ m) to the observable universe (10²⁷ m), or
switch to **Time** and go from the Planck time to the age of the universe.

## Run it

1. Install [Godot 4.3 or newer](https://godotengine.org/download) (the standard
   build; no .NET needed).
2. Open Godot, choose **Import**, and pick `godot/project.godot`.
3. Press **F5**.

## Controls

| Input | Does |
| --- | --- |
| Slider along the bottom | Zoom, one decade per notch of the scale |
| Mouse wheel / trackpad pinch over the view | Zoom a tenth of a decade |
| Click an object in the list, or a circle | Glide to that object |
| `+` / `-`, Page Up / Page Down | Zoom by 0.1 or 1 decade |
| Home / End | Jump to the smallest / largest end |
| `T` or the Length/Time menu | Switch between lengths and durations |

The circles sit side by side on a baseline in size order, each at its true size
relative to the others. The focused object (white outline, highlighted in the
list) is the one that fills about 60 % of the view; the panel under the list
shows its declared value, range, provenance and notes. The bar in the top-left
corner is a 1, 2 or 5 × 10ⁿ ruler for the current zoom.

## Data

- `data/objects.json` is an exact copy of `fixtures/objects.json`. Godot can
  only read files inside its own project folder, hence the copy;
  `src/catalog/godot.test.ts` fails if the two ever differ.
- `data/objects.godot.json` holds the extra objects the viewer needs (quarks,
  vehicles, moons, planets, stars, galaxies, and all the durations), in the
  same schema. The same test runs them through the web catalog's parser, so
  they obey the same provenance rules: a measured or exact value must cite a
  source, and estimates say so.

After changing `fixtures/objects.json`, copy it over:
`cp fixtures/objects.json godot/data/objects.json`.

## Numbers

The catalog's decimal strings stay authoritative, and the list shows them as
written. Placement on screen uses 64-bit floats **in log space only**: each
value becomes `log10(mantissa) + exponent + log10(unit)` without ever forming
the number, and pixel sizes are recomputed from `10^(log10 size − zoom)` every
frame. There are no world coordinates, so nothing in the viewer depends on the
precision questions the rest of this repository studies. The exact rational
core, the Q128.128 / Q512.512 machines and the error ledgers stay in
TypeScript; a future Godot lens that shows representation error would consume
their output rather than reimplement them.

## Not yet

- Exporting builds (add `data/*.json` to the export preset's non-resource
  filter when you do).
- Icons or images: objects are circles with text, by design for the MVP.
- Range bars: ranges are shown as text in the info panel, not drawn.
