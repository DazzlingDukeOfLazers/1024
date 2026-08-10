# PLAN.md — standing plan for autonomous sessions

Written 2026-08-09 when Daniel switched the model to Fable and said the machine
would run mostly unattended, with him occasionally answering questions or
starting fresh sessions to pick this up. Rewritten 2026-08-10 at the end of a
full day's work: the five original phases are all complete, so what follows is
the standing protocol plus a short Position, rather than a phase list.

A fresh session with no memory of the previous one reads `CLAUDE.md`, this file,
and the tail of `TASKS.md`, and continues.

## Position

> A few lines. The log lives in git — the previous version of this section had
> grown into a changelog of twenty commits, which is the thing it tells you not
> to do.

- Branch `dd/exact-quantity-core`, pushed. **962 unit tests, 150 Playwright,
  315 bit-for-bit GPU checks, full gate green.** CI runs the gate on every push.
- All five plan phases from 2026-08-09 are complete, and so is a day of backlog
  work on top of them. `git log` is the record; `TASKS.md` is what to plan from.
- Two things landed today that change how later work should be framed:
  - **The Lab now has three rotation panels' worth of §7**, and the last of
    them is the first **declared** reference in the project — 60 digits from
    `tools/oracle.py`, because Niven's theorem forbids an exact angle and an
    exact rotation matrix together. Anything built on it must keep saying that
    an error below the last declared digit is *unmeasured*, not small.
  - **`src/source.test.ts`** scans every shipped file for invisible characters.
    Three landed in source in one day and all three passed the whole gate.

## What to do next

In rough order of value. Nothing here is urgent; the project is in a good state.

1. **The small closures deferred from 2026-08-10.** The `how-many-fit-volume`
   bulk condition (stated, not enforced — and vivid: asking how many kilometres
   fit inside a millimetre answers 6.4 × 10^-19); the lattice zoom control, a
   UI_SPEC gap; the resolution chart's power-of-two staircase (**measure first**
   — the deviation is likely sub-pixel, and closing it with the measurement is
   the honest outcome); Atlas relation arcs, whose degenerate cases are already
   measured and written up in `TASKS.md`.
2. **Velocity integration**, the third of PROJECT_SPEC §7's three. Rotation
   covered the conserved-quantity shape twice over; integration is the one where
   the *step size* is the variable and the error is a function of it.
3. **§17's subgroup organization.** Decide before writing: WGSL subgroups are an
   optional feature *and* the subgroup size is hardware-dependent (RDNA-3 is
   wave32 or wave64), so a 32-lane scan would be verified here and unverified
   everywhere else — a weaker claim than the rest of that track makes.

Do **not** reopen the measured deferrals without a new reason. Roughly a dozen
backlog items are closed on evidence rather than neglect — the search index, the
Ruler's six-object cap, share-payload compression, `replaceState` history, the
overflow-policy oracle, zero-limb skipping. Seven more need a person or a device
this machine does not have (a real screen reader, anomalous trichromacy, a
phone-class perf run). The mass dimension is out by CLAUDE.md's own instruction.

## Session protocol

1. Read `CLAUDE.md` (project rules), this file, and the tail of `TASKS.md`.
2. Run the full gate before changing anything, so a broken start is discovered
   before it has an author: `npm run typecheck && npm run lint &&
   npm run format:check && npm test && npx playwright test`.
3. Work the next item, smallest slice first. The disciplines that have caught
   every defect so far, in one place:
   - **Measure before designing.** Numbers in comments, commit messages and
     tests are measured, never derived from what sounds right. The
     2^12-not-10^6 coarsening factor, the "583" step count that was 582, and the
     "46 digits" that was 45 because it counted a minus sign are all in the git
     log as warnings.
   - **Falsify every new test** — break the code, watch the test fail, restore.
     Use `tools/mutate.py` (never ad-hoc shell: two sessions hung and left the
     tree mutated before it existed). A mutant killed by the *build* proves
     nothing about the tests; rewrite it so the code still compiles.
   - **Look at the app.** `$env:SHOTS='<filter>'; npx playwright test
     e2e/screenshots` writes PNGs to `shots/`; read them. Tiling them into a
     contact sheet scans the whole app at once instead of sampling. The DOM
     passing is not the panel being right — two of the three whole-app reviews
     found defects in states where every rule already passed.
   - **Anti-vacuity.** Any assertion that "nothing is wrong" must prove it
     examined something. Empty states are the interesting ones.
   - **A label is a claim.** The conformance sweep reads row and column headers
     for exactness vocabulary and demands the verified value beside them. When
     it fires, the usual fix is that the header was making a claim about a cell
     it was not about — not that the rule is too strict.
4. Gate again, commit with the project's usual commit-message discipline
   (what was measured, what surprised, what was killed), push.
5. Update **Position** above and add discoveries to `TASKS.md`. Finishing work
   here is *not* finishing the `TASKS.md` entry that asked for it — the second
   backlog audit found six open items already done, and every one had been
   recorded somewhere other than the entry.
6. If a decision needs Daniel, add it to **Questions for Daniel** below, commit,
   and move to the next unblocked item — never idle behind a question.

## Environment facts (hard-won; do not rediscover)

- Node is not on PATH by default. Prefix PowerShell commands with:
  `$env:PATH = "C:\Users\danie\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;$env:PATH"`
- PowerShell 5.1 `Get-Content`/`Set-Content` corrupt BOM-less UTF-8. Edit files
  with the Edit tool or Python `io.open(..., encoding='utf-8', newline='')`.
  The same trap applies to Python `subprocess(text=True)` — pass
  `encoding='utf-8'` explicitly.
- **Writing a file can insert invisible characters.** A NUL, a U+2028 and a
  second NUL landed in source in one day, all through the file-writing path,
  and all passed typecheck, lint, prettier and the suite. `src/source.test.ts`
  catches them now. When a string replacement that should obviously match keeps
  failing, suspect this before suspecting the pattern.
- PowerShell here-strings and bash heredocs both break on this project's prose
  (apostrophes, backslashes, `§`). For anything longer than a line, write the
  script to the scratchpad with the Write tool and run it by path.
- The in-app browser pane does not composite when hidden: ResizeObserver and
  rAF never fire, so every self-measuring view sits at its fallback width and
  the app looks broken when it is not. Screenshots via Playwright instead.
- **WebGPU**: Playwright's bundled Chromium finds the adapter (AMD RDNA-3) but
  `requestDevice` fails (`dxil.dll Windows Error: 87` — DXC not packaged).
  Branded Chrome works: `test.use({ channel: 'chrome', launchOptions: { args:
  ['--enable-unsafe-webgpu', '--enable-gpu'] } })`. Proven by
  `e2e/webgpu.spec.ts`, which runs every committed fixture through the real GPU.
  That spec skips on CI deliberately.
- Mutation testing: `python tools/mutate.py --file … --old … --new … --label …
  --test <vitest targets>`. Per-mutant timeout, revert in a `finally`,
  NO-MATCH counts as a failure. It drives vitest only; WGSL and JSX need the
  same shape written by hand, with the read-the-backup-first restore.
- Ad-hoc mutation must restore with read-the-backup-first. The one-expression
  idiom `io.open(p,'w').write(io.open(bak).read())` **truncates the target
  before the read can fail** — it emptied a source file once. Read the backup
  into a variable, then write; guard on the backup existing.
- `URL.pathname` is `/C:/Users/...` on Windows. Handing that to `readFileSync`
  produces `C:\C:\Users\...`; pass the `URL` object instead.
- Dev server for the browser pane (rarely needed): `.claude/launch.json` in
  `personal-git/` defines `scale-atlas`.

## Questions for Daniel

> Sessions append here instead of blocking. Answer whenever you check in.

- ~~The far-origin ruler's grid labels~~ — **answered: offset notation.**
  Shipped: `+1 × 10^23 mm` stated once, ticks labelled −6 … 5.
- ~~Compute panel scope~~ — **answered 2026-08-10: add an op selector.** Shipped:
  SUB, MUL_WIDE and DIV_REM, each drawn as what its lanes pass each other, and
  DIV_REM deliberately drawn with no marker at all.
- ~~Which substantial piece for 2026-08-10~~ — **answered: rotation drift**, then
  extended by Daniel mid-day into the two-track race.
- **Nothing open.**

## For review

Two commits carry citations or citation checks that were made unattended, per
the 2026-08-09 decision that this is allowed if marked and quoted:

- `3defc07` — the packing fraction, Scott & Kilgour 1969, with the source quoted
  in the message and the theoretical maximum distinguished from it.
- `8e7939e` — **CODATA 2022 publishes the identical Planck length** to CODATA
  2018, checked against the NIST value page. That is why the second constant set
  is derived from the published uncertainty rather than from a later adjustment.
