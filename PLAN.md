# PLAN.md — standing plan for autonomous sessions

Written 2026-08-09, when Daniel switched the model to Fable and said the machine
would run mostly unattended for a couple of days, with him occasionally
answering questions or starting fresh sessions to pick this up. This file is the
handoff between those sessions: a fresh session with no memory of the previous
one reads this, the tail of `TASKS.md`, and continues.

Decisions Daniel made when this plan was written (2026-08-09):

- Main track: **§18 as the spine, polish interleaved** when blocked or between
  phases.
- Visual regression: **curated subset** (~10 states × 2 widths), locked only
  after the §22 animation work settles the UI shape.
- Citations: **allowed unattended**, committed clearly marked for his review,
  with sources quoted in the commit message.
- If GPU verification had been impossible: CPU limb machine + unverified WGSL.
  (Moot — see Environment facts: GPU verification **works** here.)

## Today's plan (2026-08-10, ~8–10 hours)

Decisions Daniel made when this was written:

- **Block 1 is the rotation drift experiment** (PROJECT_SPEC §7), not the
  Ruler's second axis.
- **The compute panel gets an op selector** — the question queued on 2026-08-09
  is answered. SUB, MUL and DIV_REM get views alongside ADD.
- Daniel is **around intermittently**: work autonomously, ask when a decision
  would change the shape of the work rather than queueing it, check in between
  blocks.

Blocks, in order. Each ends with a commit and a Position update.

- [ ] **0. Look at the whole app** (~30 min). Ten commits landed on 2026-08-10
  and four moved visual baselines; the last systematic screenshot review of
  every swept state at both widths predates all of them. This half hour has
  found four defects twice before.
- [ ] **1. Rotation drift** (~3–4 h). §7's repeated rotations. Use an exact
  *rational* rotation — a Pythagorean-triple matrix such as (3/5, 4/5) — so the
  reference stays exactly on the unit circle while each finite machine spirals.
  `spacetime.ts` already has four-register X/Y/Z/T frames, so this needs no
  change to the scalar experiment runner. Norm drift is the headline.
- [ ] **2. Compute panel op selector** (~2 h). Now an answered request rather
  than a queued question, so it outranks the rest.
- [ ] **3. Small closures** (~2 h), as many as fit: the `how-many-fit-volume`
  bulk condition; the lattice zoom control (a UI_SPEC gap); the resolution
  chart's power-of-two staircase (measure first — likely sub-pixel, and closing
  it with the measurement is the honest outcome); Atlas relation arcs with the
  degenerate cases already measured.
- [ ] **4. Handoff** (~1 h). Rewrite this file for the next unattended stretch,
  tidy TASKS, re-verify the README counts.

Deliberately **not** in today's plan, and why, so a later session does not
re-litigate it: twelve backlog items are measured deferrals whose reasons still
hold (search index, Ruler's six-object cap, share compression, `replaceState`
history, overflow-policy oracle, zero-limb skipping, and six more) — reopening
one needs a new reason, not spare time. Seven more need a person or a device
this machine does not have. The mass dimension is out by CLAUDE.md's own
instruction. User-authored experiments in the share payload are blocked on an
authoring UI that does not exist.

## Position

> Update this section at the end of every session. Keep it to a few lines;
> the log lives in git.

- Branch `dd/exact-quantity-core`; 807 unit tests, 95 Playwright, all green.
  CI runs the gate on every push.
- Current phase: **1 complete** — the §18 ladder is done; 834 unit tests,
  98 Playwright.
  - 1.1: 202 limb fixtures; Python kernels asserted against native ints;
    DIV_REM needs **no** extra limb (R ≤ 2^k − 1; proof in `limb_divrem`).
  - 1.2: `src/core/limbs/limbs.ts` — u32-only kernels, 32×32→64 from 16-bit
    halves, metrics per kernel, ten mutants killed, op-list sweep.
  - 1.3: `src/gpu/` — WGSL kernels, harness, window bridge. **All 195 op
    fixtures pass bit-for-bit on the real GPU** (amd rdna-3, branded Chrome).
  - 1.4: `ComputeLanes.tsx` — the register as 32 × u32 lanes, A + B drawn
    from the kernel's own carry trace, §20 metrics, the two-machines product
    row, and a GPU row that reports agreement-with-CPU or honest absence.
    Falsified: a panel that pretends agreement when the device is absent
    fails the sweep. Screenshots reviewed at 1280 and 420.
- Phase 2 complete (2.1 autoplay, 2.2 accumulation). The multiply carries an
  opt-in trace (executed products only — §4's skipped work is never
  animated); the matrix highlights the current product, an accumulator strip
  fills, scrub keyed to the run and resting at the end so the panel at rest
  is unchanged. Same intent/derived-running/pause-on-touch design as the
  tape; both play buttons have distinct accessible names. 838 unit tests,
  104 Playwright; strip-ignores-scrub mutant killed.
- Phase 3 complete: `e2e/visual.spec.ts`, 10 curated states × 2 widths, 20
  baselines (3.3 MB) committed. Passes twice unchanged; a 0.05rem table
  padding change fails 20 of 21. Skips on CI (Windows-rendered fonts);
  procedure documented in docs/TEST_STRATEGY.md. A guard test asserts every
  curated name still exists in `states.ts`.
- Phase 4 in progress: skip link and colour-vision check done. Remaining:
  the ~50 formatter call sites dropping the exactness flag, the
  resolution-chart legend overlap, the 1e20 m grid labels, and the
  `role="application"` reconsideration.
- **Phase 4 complete** except the 1e20 m grid labels, which are queued as a
  question for Daniel rather than guessed at. 853 unit tests, 130 Playwright.
- **All five plan phases are complete.** 866 unit tests, 131 Playwright.
- Backlog work since (Daniel opened the backlog explicitly, so the "not in
  scope unattended" list below no longer binds):
  - Comparator area/volume with the similarity assumption named (`147ae5f`).
  - The Atlas listed one neighbour twice, and its "also at this size" table was
    captioned "unrelated" while naming related objects (`60e6c1a`). Both found
    by screenshotting `atlas/related`, neither reachable from the DOM.
    `createCatalog` now refuses both directions of a relation.
  - `semanticDetail` declared a camera resolution and was read as an object
    size (`9d244e1`). Renamed to `minMeters`/`maxMeters`; still set by no
    fixture, deliberately.
  - The Ruler uses the graph (`78a4c8c`): it still chooses what to draw by
    size, and now says which of those objects are related to each other and
    which are there by coincidence of magnitude. Its empty-state message was
    false at the far-origin preset — two reasons, one sentence.
  - The Lab charts drift (`9af389d`): log10 magnitude per row, sign as a
    hollow dot, exact checkpoints off the axis. A shared axis was written,
    screenshotted, and abandoned — every row was a horizontal line. Also found
    that every sweep had been evaluating the million-iteration run mid-flight.
  - `how-many-fit-volume` (`3defc07`), with the packing model cited —
    **contains citations for review**, sources quoted in the commit message.
    Also fixed a defect that shipped with the area/volume work: the "To scale"
    strip draws lengths and said nothing about it under a cubed headline.
  - The drift chart plots against log iterations (`f8e8474`), so the
    fixed-point machines come out straight at slope 1 — error proportional to
    the number of operations — and binary64 visibly does not.
  - §17's cooperating lanes for ADD (`8816232`): one limb per lane, carry by
    Kogge–Stone scan. Then the third organization (`8 lanes × 4 limbs`,
    ripple inside and scan across). Eight WGSL mutants killed, one equivalent
    mutant proved rather than tested. No speed claim anywhere.
    Then SUB on the same scan, extracted and shared — a borrow is a carry with
    the signs turned round, and only the two predicates differ.
  - Second backlog audit: six open TASKS items were already done, every one
    recorded in a different section from the entry asking for it — including
    two phases finished *here*, in this file. **Closing a phase here is not
    closing the TASKS entry**, and TASKS is what the next session reads.
  - An object with two lengths now declares which one it *is*; `primaryLength`
    was returning whichever JSON key came first. The door has a width.
  - A second constant set, so §3's "conditioned on the declaration" is
    watchable rather than asserted. **Contains a citation check for review**:
    CODATA 2022 publishes the identical Planck length, so the second set is
    derived from the published uncertainty instead.
  - The Microscope has a subnormal inset, so binary64 going flat below
    2^-1022 is on screen rather than only in prose. Two charts announcing
    themselves identically was an accessibility defect two Playwright
    selectors caught.
- 932 unit tests, 144 Playwright, 315 GPU checks, full gate green.
- Next action: pick from the TASKS backlog. Open items now: §17's subgroup
  organization (optional WGSL feature *and* hardware-dependent subgroup size,
  so it would be a weaker claim than the rest of this track — decide before
  writing), the search index, and the bulk condition on `how-many-fit-volume`
  (stated, not enforced). Keep the same disciplines. One question is open for
  Daniel below.

## Session protocol

1. Read `CLAUDE.md` (project rules), this file, and the tail of `TASKS.md`.
2. Run the full gate before changing anything, so a broken start is discovered
   before it has an author: `npm run typecheck && npm run lint &&
   npm run format:check && npm test && npx playwright test`.
3. Work the next unchecked item in the current phase, smallest slice first.
   The disciplines that have caught every defect so far, in one place:
   - **Measure before designing.** Numbers in comments, commit messages and
     tests are measured, never derived from what sounds right. The 2^12-not-10^6
     coarsening factor and the "583" step count that was actually 582 are both
     in the git log as warnings.
   - **Falsify every new test** — break the code, watch the test fail, restore.
     Use `tools/mutate.py` (never ad-hoc shell: two sessions hung and left the
     tree mutated before it existed).
   - **Look at the app.** `$env:SHOTS='<filter>'; npx playwright test
     e2e/screenshots` writes PNGs to `shots/`; read them. The DOM passing is
     not the panel being right — the trap scenario blanked an entire lens while
     every geometric rule passed.
   - **Anti-vacuity.** Any assertion that "nothing is wrong" must prove it
     examined something. Empty states are the interesting ones.
4. Gate again, commit with the project's usual commit-message discipline
   (what was measured, what surprised, what was killed), push.
5. Update **Position** above; check boxes below; add discoveries to `TASKS.md`.
6. If a decision needs Daniel, add it to **Questions for Daniel** below, commit,
   and move to the next unblocked item — never idle behind a question.

## Environment facts (hard-won; do not rediscover)

- Node is not on PATH by default. Prefix PowerShell commands with:
  `$env:PATH = "C:\Users\danie\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;$env:PATH"`
- PowerShell 5.1 `Get-Content`/`Set-Content` corrupt BOM-less UTF-8. Edit files
  with the Edit tool or Python `io.open(..., encoding='utf-8', newline='')`.
  The same trap applies to Python `subprocess(text=True)` — pass
  `encoding='utf-8'` explicitly.
- The in-app browser pane does not composite when hidden: ResizeObserver and
  rAF never fire, so every self-measuring view sits at its fallback width and
  the app looks broken when it is not. Screenshots via Playwright instead.
- **WebGPU**: Playwright's bundled Chromium finds the adapter (AMD RDNA-3) but
  `requestDevice` fails (`dxil.dll Windows Error: 87` — DXC not packaged).
  Branded Chrome works: `test.use({ channel: 'chrome', launchOptions: { args:
  ['--enable-unsafe-webgpu', '--enable-gpu'] } })`. Proven by
  `e2e/webgpu.spec.ts`, which executes a carry-propagating WGSL add and checks
  the bits. That spec skips on CI deliberately.
- Mutation testing: `python tools/mutate.py --file … --old … --new … --label …
  --test <vitest targets>`. Per-mutant timeout, revert in a `finally`,
  NO-MATCH counts as a failure.
- Ad-hoc mutation of e2e-tested code (mutate.py only drives vitest) must
  restore with read-the-backup-first. The one-expression idiom
  `io.open(p,'w').write(io.open(bak).read())` **truncates the target before
  the read can fail** — it emptied a source file when the backup was missing.
  Read the backup into a variable, then write; guard on the backup existing.
- Dev server for the browser pane (rarely needed): `.claude/launch.json` in
  `personal-git/` defines `scale-atlas`.

## Phase 1 — §18: the WebGPU compute track

The last untouched section of `docs/WIDE_INTEGER_ARCHITECTURE.md`. Read §17–§19
before starting. The ladder mirrors how every other track here was built:
oracle first, CPU simulation second, the real thing third, UI last.

- [x] **1.1 Python limb prototype + fixtures.** Extend `tools/oracle.py` with a
  u32-limb model (`array of 32 × u32` = one 1024-bit value) and generate
  fixtures for ADD, SUB, BITLEN, SHL, SHR, MUL_WIDE, DIV_REM covering §19's
  stress list: all-zero, all-one, min/max signed, long carry chains, long
  borrow chains, single-bit sparse, dense random (seeded, not `random()` at
  import time), leading-zero-heavy, division exact and with remainder,
  overflow, narrowing. Commit regenerated `fixtures/oracle.json`.
  *Done means:* fixtures exist and the Python model agrees with Python's
  native ints on every case — the prototype is checked against an oracle too.
- [x] **1.2 CPU limb machine** in `src/core/limbs/`. The kernels use only u32
  operations (`>>> 0` semantics, explicit carries/borrows) — `bigint` appears
  at the encode/decode boundary and in tests, never inside a kernel, because a
  kernel that secretly uses bigint is not a simulation of anything. Checked
  against the 1.1 fixtures AND against `core/wide` on random values. Metrics
  per §20 (limb ops, carries taken, cycles) so it can join the benchmarks.
  *Done means:* all fixtures pass; a mutation pass on carry/borrow logic kills
  every mutant; oracle test sweeps the op list so new ops are automatically
  covered.
- [x] **1.3 WGSL shaders + browser harness.** One WGSL kernel per op, textually
  mirroring the 1.2 kernels. A small `src/gpu/` harness: capability detection,
  buffer plumbing, dispatch. Playwright spec in the `e2e/webgpu.spec.ts`
  pattern (branded Chrome + flags) runs every fixture through the GPU and
  compares bit-for-bit; skips loudly when no adapter.
  *Done means:* every 1.1 fixture passes on the actual GPU on this machine.
- [x] **1.4 Compute panel in the Architecture Lab.** §18: "the browser UI can
  visualize the operation while the compute shader performs it." Minimal
  first: limb lanes with carry propagation shown, CPU/GPU agreement stated per
  §19 (never GPU-as-its-own-reference), and the §20 metrics beside the
  digit-serial ones. Screenshot both widths, read the PNGs, sweep the new
  states (add to `e2e/states.ts`), and leave a screenshot-backed design note
  in **Questions for Daniel** rather than blocking on taste.
  *Done means:* panel renders in all swept states; conformance sweep green;
  screenshots reviewed.

## Phase 2 — §22 finish (before baselines, because it changes shape)

- [x] **2.1 Autoplay for the quotient tape.** Play/pause control stepping
  `divisionStep`; honour `prefers-reduced-motion` (no autoplay, scrubber
  still works); e2e test drives it and checks it stops at the end. Not part
  of share state — a link carries a position, not a playing animation.
- [x] **2.2 Accumulation animation (§22).** "small product → exact shift →
  wide accumulator": step through partial products of the existing multiply
  matrix, highlighting the product, its shifted position, and the accumulator
  filling. Same reduced-motion rule. Sweep the new states.

## Phase 3 — visual-regression baselines (curated)

- [x] After Phase 2: pick ~10 representative states (one per lens plus the
  densest architecture ones), `toHaveScreenshot` at 1280 and 420, commit the
  baselines. Document the update procedure in `docs/TEST_STRATEGY.md`
  (`--update-snapshots` and when it is legitimate). Baselines are
  Windows-rendered; gate the spec out of CI (fonts differ on Linux) with a
  comment saying exactly that.

## Phase 4 — polish batch (interleave when blocked)

- [x] Skip link — first tab stop jumps to the lens panel.
- [x] Colour-vision check: `src/ui/colourVision.ts` + tests. Nothing failed;
  the method and its limits are recorded in TASKS.
- [x] The formatter call sites that drop the exactness flag. **The plan
  mis-stated this**: TASKS said they were left alone *deliberately* and to
  revisit only if a label started making a claim — wiring all 40 through
  `Rendered` would have made the UI worse. Re-audited (all 40 still under
  non-claiming labels) and the missing guard closed instead.
- [x] Resolution-chart legend placed by measurement (`chooseClearRect`).
- [ ] 1e20 m grid labels are unreadable digit strings (TASKS ~line 898) —
  engineering notation there.
- [x] `role="application"` reconsideration — announced-vs-handled key sets held
  together, focus escape and control alternatives tested. A real screen-reader
  pass stays open in TASKS; nothing here can hear.

## Phase 5 — citations (allowed unattended, marked for review)

- [x] The task as rewritten in TASKS: cite the four or five
  catalog objects that are genuinely citable (CODATA/IAU-class sources), fix
  any value the source contradicts, and mark the commit `citations — for
  Daniel's review` with the sources quoted in the message. No invented
  precision: a range object keeps its range.

## Not in scope unattended

Comparator area/volume, progressive semantic detail, search indexing, share
payload compression, Three.js, dependency upgrades, anything requiring an
account or publishing beyond the existing GitHub remote, share-schema version
bumps. If one of these becomes necessary, write up why and stop that thread.

## Questions for Daniel

> Sessions append here instead of blocking. Answer whenever you check in.

- ~~The far-origin ruler's grid labels~~ — **answered: option 1, offset
  notation.** Shipped: `+1 × 10^23 mm` stated once, ticks labelled −6 … 5,
  reconstruction asserted exactly.

- ~~**Compute panel scope**~~ — **answered 2026-08-10: add an op selector.**
  SUB, MUL and DIV_REM get views alongside ADD. The A/B lane rows were not
  chosen; leave the strip as the sum alone unless the op views want them.

  Original question, kept for the reasoning:

- **Compute panel scope (2026-08-09, phase 1.4).** The lane panel visualizes
  ADD only — the §18 first op, where carry propagation is the story. Worth
  extending to an op selector (SUB borrows, MUL's 4096-multiply grid, DIV_REM
  lane traffic)? And should the strip also draw A's and B's lanes above the
  sum, at the cost of two more rows? Current look: `shots/architecture--dense-*.png`
  (regenerate any time: `$env:SHOTS='architecture'; npx playwright test
  e2e/screenshots`). Default if unanswered: leave as ADD-only; §22's
  accumulation animation (phase 2.2) will add motion to the multiply story
  instead.
