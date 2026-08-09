# Revision Notes

This package is the revised Scale Atlas / Numerical Microscope plan.

Major changes from the prior draft:

1. `Q128.128` now has a configurable exact **machine base unit** (`@mm`, `@m`, `@km`, etc.), separate from display units.
2. `ExactReference` is explicitly unbounded rational truth; the finite `Q512.512` 1024-bit system is only an error accumulator.
3. Every simulated representation owns an independent `ErrorLedger`, with operand-encoding contribution separated from operation rounding/quantization.
4. Million-step experiments use first-class compact `repeat` steps with checkpoints and streaming/chunk-friendly execution while still performing every machine operation.
5. Versioned shareable URLs are now a v0 requirement rather than a later enhancement.
6. Rendering tests require exact camera-origin subtraction before conversion to JavaScript `number`; Atlas logarithms require an exact-safe Rational path.
7. Binary64 inspection preserves `+0`/`-0`, infinities, NaN, and exposes separate `gapBelow` / `gapAbove`.
8. Planck nominal constants carry provenance/precision/uncertainty, kept separate from numerical representation error.
9. v0 catalog scope is consistently 20–30 curated objects.
10. A floating-origin/rebasing experiment is part of the initial numerical teaching set.
11. `docs/NUMERICS.md` is the single source of truth for all machine semantics.

Claude Code should still begin with `CLAUDE.md` and follow its document reading order.
