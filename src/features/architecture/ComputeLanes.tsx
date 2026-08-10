/**
 * The compute-lane panel: the same register, seen as WGSL sees it.
 *
 * docs/WIDE_INTEGER_ARCHITECTURE.md §17–§18. The rest of the Architecture Lab
 * draws the register in radix-2^N digits; this panel draws it as the
 * `array<u32, 32>` a compute shader owns, and shows one operation — A + B —
 * with the carry each lane emitted, from the kernel's own trace rather than a
 * UI-side re-derivation.
 *
 * §19 is enforced in the wording: the GPU row reports *agreement with the CPU
 * machine on these operands*, checked bit-for-bit in this browser, or it
 * reports that no WebGPU device exists here. It never says "verified" on the
 * GPU's own authority, and absence is stated rather than papered over —
 * headless panes and CI have no device, and pretending otherwise would make
 * the panel a liar exactly where the sweep runs it.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  LIMBS_PER_VALUE,
  addLimbs,
  divRemLimbs,
  fromLimbs,
  mulLimbs,
  subLimbs,
  toLimbs,
} from '../../core/limbs/limbs';
import { COMPUTE_OPS, COMPUTE_OP_DESCRIPTIONS, type ComputeOp } from './computeOps';
import { type LimbOrganization, createGpuLimbMachine } from '../../gpu/harness';
import { describeWideLiteral } from '../../core/wide/parse';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

/**
 * Every §17 organization *of ADD*, checked on the operands on screen. Listed
 * here rather than written into the check so the sentence below and the work
 * done cannot drift apart — the panel names three, so three run.
 *
 * SUB has a lane organization too, but this panel draws an addition, and a
 * verdict about a subtraction it is not showing would be a claim about
 * something else.
 */
const ADD_ORGANIZATIONS: readonly LimbOrganization[] = ['add', 'addLanes', 'addBlocks'];

const NOMINAL_WIDTH = 820;
const LANE_HEIGHT = 84;
const LABEL_FONT_SIZE = 9;

type GpuVerdict =
  | { readonly kind: 'checking' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'agrees'; readonly description: string }
  | { readonly kind: 'disagrees'; readonly description: string };

/**
 * One row of lanes, with a marker at every boundary that signalled.
 *
 * `marks` is optional because not every operation has anything to put there —
 * a restoring division's lanes do not pass each other a carry, and inventing a
 * dot to keep the picture uniform would be drawing a signal that is not in the
 * machine.
 */
function LaneStrip({
  limbs,
  marks,
  caption,
  markCaption,
}: {
  limbs: Uint32Array;
  marks?: Uint8Array | undefined;
  caption: string;
  markCaption: string;
}) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const lanes = limbs.length;
  const gap = lanes > 32 ? 1 : 2;
  const cell = Math.max((width - gap * (lanes - 1)) / lanes, 1);
  const markedCount = marks === undefined ? 0 : marks.reduce((total, lane) => total + lane, 0);

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${LANE_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={
          marks === undefined
            ? `${caption}: ${lanes} lanes, nothing passed between them`
            : `${caption}: ${markedCount} of ${lanes} lanes signalled`
        }
      >
        <text x={0} y={12} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.6}>
          {caption}, lane {lanes - 1} down to lane 0
        </text>
        {Array.from(limbs)
          .reverse()
          .map((limb, index) => {
            const lane = lanes - 1 - index;
            const x = index * (cell + gap);
            const active = limb !== 0;
            return (
              <g key={lane}>
                <rect
                  x={x}
                  y={20}
                  width={cell}
                  height={26}
                  rx={2}
                  fill="currentColor"
                  fillOpacity={active ? 0.55 : 0.08}
                  stroke="currentColor"
                  strokeOpacity={active ? 0.8 : 0.2}
                />
                {marks?.[lane] === 1 && (
                  // The carry this lane emitted, drawn at the boundary the bit
                  // crossed on its way to lane + 1 — which is this lane's left
                  // edge, since higher lanes sit leftward. Lane 31's carry is
                  // the one that leaves the register, clamped inside the frame.
                  <circle
                    cx={Math.max(x - gap / 2, 3)}
                    cy={56}
                    r={2.5}
                    fill="currentColor"
                    fillOpacity={0.9}
                  />
                )}
                {cell > 22 && (
                  <text
                    x={x + cell / 2}
                    y={76}
                    fontSize={LABEL_FONT_SIZE}
                    textAnchor="middle"
                    fill="currentColor"
                    fillOpacity={active ? 0.9 : 0.35}
                  >
                    {lane}
                  </text>
                )}
              </g>
            );
          })}
        <text
          x={width}
          y={12}
          fontSize={LABEL_FONT_SIZE}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.6}
        >
          {markCaption}
        </text>
      </svg>
    </div>
  );
}

export interface ComputeLanesProps {
  /** Magnitudes, both below 2^1024 — sign belongs to the boundary (§6). */
  readonly a: bigint;
  readonly b: bigint;
  readonly op: ComputeOp;
  readonly onOpChange: (op: ComputeOp) => void;
  /** The digit machine's product of the same operands, for the §21 row. */
  readonly digitProduct: bigint;
  readonly digitCycles: number;
  readonly digitBits: number;
}

export function ComputeLanes({
  a,
  b,
  op,
  onOpChange,
  digitProduct,
  digitCycles,
  digitBits,
}: ComputeLanesProps) {
  const cpu = useMemo(() => {
    const aLimbs = toLimbs(a);
    const bLimbs = toLimbs(b);
    const sum = addLimbs(aLimbs, bLimbs, true);
    const difference = subLimbs(aLimbs, bLimbs, true);
    const product = mulLimbs(aLimbs, bLimbs, true);
    // A divisor of zero has no quotient. The panel says so rather than throwing
    // the lens down, the way the division panel already does.
    const division = fromLimbs(bLimbs) === 0n ? undefined : divRemLimbs(aLimbs, bLimbs);
    // Longest unbroken run of carrying lanes: the §19 "long carry chain",
    // measured on the actual operands. Presentation counting, not arithmetic.
    let longestChain = 0;
    let run = 0;
    for (const lane of sum.carries!) {
      run = lane === 1 ? run + 1 : 0;
      longestChain = Math.max(longestChain, run);
    }
    return { aLimbs, bLimbs, sum, difference, product, division, longestChain };
  }, [a, b]);

  // The verdict is keyed to the operands it was computed for, so a change of
  // operands shows "checking" by derivation rather than by a synchronous
  // setState at effect start — which is also simply truer: an answer about
  // different operands is not an answer about these.
  const [checked, setChecked] = useState<
    { readonly operands: unknown; readonly verdict: GpuVerdict } | undefined
  >(undefined);
  const gpu: GpuVerdict =
    checked !== undefined && checked.operands === cpu ? checked.verdict : { kind: 'checking' };

  useEffect(() => {
    let cancelled = false;
    const conclude = (verdict: GpuVerdict): void => {
      if (!cancelled) setChecked({ operands: cpu, verdict });
    };
    const check = async (): Promise<void> => {
      const machine = await createGpuLimbMachine();
      if (machine === undefined) {
        conclude({ kind: 'absent' });
        return;
      }
      try {
        // Both §17 organizations, against the CPU machine — never against each
        // other. Two shaders agreeing is two shaders agreeing.
        const matches = async (organization: LimbOrganization): Promise<boolean> => {
          const out = await machine.run(organization, cpu.aLimbs, cpu.bLimbs);
          return (
            cpu.sum.limbs.every((limb, index) => out[index] === limb) &&
            (out[32] === 1) === cpu.sum.carryOut
          );
        };
        const verdicts = [];
        for (const organization of ADD_ORGANIZATIONS) verdicts.push(await matches(organization));
        conclude(
          verdicts.every(Boolean)
            ? { kind: 'agrees', description: machine.description }
            : { kind: 'disagrees', description: machine.description },
        );
      } finally {
        machine.destroy();
      }
    };
    check().catch(() => {
      conclude({ kind: 'absent' });
    });
    return () => {
      cancelled = true;
    };
  }, [cpu]);

  const sumValue = fromLimbs(cpu.sum.limbs);
  const productsAgree = fromLimbs(cpu.product.limbs) === digitProduct;

  const description = COMPUTE_OP_DESCRIPTIONS[op];
  // `rowCarryOut[i]` belongs to product limb `i + 32`, so the marks are placed
  // where the carry landed rather than where the row that produced it started.
  const productMarks = new Uint8Array(cpu.product.limbs.length);
  cpu.product.rowCarryOut!.forEach((carry, row) => {
    productMarks[row + LIMBS_PER_VALUE] = carry === 0 ? 0 : 1;
  });

  return (
    <section className="panel">
      <h3>The same register, as 32 × u32 lanes</h3>

      <div className="field">
        <label htmlFor="compute-op">Operation</label>
        <select
          id="compute-op"
          value={op}
          onChange={(event) => onOpChange(event.target.value as ComputeOp)}
        >
          {COMPUTE_OPS.map((name) => (
            <option key={name} value={name}>
              {COMPUTE_OP_DESCRIPTIONS[name].label}
            </option>
          ))}
        </select>
      </div>

      {op === 'add' && (
        <LaneStrip
          limbs={cpu.sum.limbs}
          marks={cpu.sum.carries!}
          caption="A + B"
          markCaption="dot: the lane emitted a carry"
        />
      )}
      {op === 'sub' && (
        <LaneStrip
          limbs={cpu.difference.limbs}
          marks={cpu.difference.borrows!}
          caption="A − B"
          markCaption="dot: the lane took a borrow"
        />
      )}
      {op === 'mulWide' && (
        <LaneStrip
          limbs={cpu.product.limbs}
          marks={productMarks}
          caption="A × B"
          markCaption="dot: a multiply row left a carry here"
        />
      )}
      {op === 'divRem' && cpu.division !== undefined && (
        <>
          <LaneStrip
            limbs={cpu.division.quotient}
            caption="A ÷ B, quotient"
            markCaption="nothing passes between these lanes"
          />
          <LaneStrip
            limbs={cpu.division.remainder}
            caption="remainder"
            markCaption="nothing passes between these lanes"
          />
        </>
      )}
      {op === 'divRem' && cpu.division === undefined && (
        <p className="error">B is zero, so there is no quotient to draw.</p>
      )}

      <p className="lens-question">
        {description.result}.{' '}
        {description.marker === undefined
          ? description.noMarker
          : `A dot means ${description.marker}.`}
      </p>

      <table className="readout">
        <tbody>
          {op === 'add' && (
            <>
              <tr>
                <th scope="row">A + B</th>
                <td className="mono">
                  {describeWideLiteral(sumValue)}
                  {cpu.sum.carryOut && (
                    <>
                      {' '}
                      <small>wrapped — the carry left the register</small>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Lanes that carried</th>
                <td className="mono">
                  {cpu.sum.carries!.reduce((total, lane) => total + lane, 0)} of {LIMBS_PER_VALUE}
                  {cpu.longestChain > 1 && (
                    <>
                      {' '}
                      <small>longest chain {cpu.longestChain}</small>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">ADD work (§20)</th>
                <td className="mono">
                  {cpu.sum.metrics.add32} adds · {cpu.sum.metrics.compare32} compares ·{' '}
                  {cpu.sum.metrics.modeledCycles} cycles
                </td>
              </tr>
            </>
          )}
          {op === 'sub' && (
            <>
              <tr>
                <th scope="row">A − B</th>
                <td className="mono">
                  {describeWideLiteral(fromLimbs(cpu.difference.limbs))}
                  {cpu.difference.borrowOut && (
                    <>
                      {' '}
                      <small>B was the larger, so this wrapped mod 2^1024</small>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Lanes that borrowed</th>
                <td className="mono">
                  {cpu.difference.borrows!.reduce((total, lane) => total + lane, 0)} of{' '}
                  {LIMBS_PER_VALUE}
                </td>
              </tr>
              <tr>
                <th scope="row">SUB work (§20)</th>
                <td className="mono">
                  {cpu.difference.metrics.add32} adds · {cpu.difference.metrics.compare32} compares
                  · {cpu.difference.metrics.modeledCycles} cycles
                </td>
              </tr>
            </>
          )}
          {op === 'mulWide' && (
            <>
              <tr>
                <th scope="row">A × B</th>
                <td className="mono">{describeWideLiteral(fromLimbs(cpu.product.limbs))}</td>
              </tr>
              <tr>
                <th scope="row">Rows that carried out</th>
                <td className="mono">
                  {productMarks.reduce((total, lane) => total + lane, 0)} of {LIMBS_PER_VALUE}
                  <br />
                  <small>
                    each row walks 32 limbs and drops whatever is still carrying into the lane above
                    them
                  </small>
                </td>
              </tr>
              <tr>
                <th scope="row">MUL_WIDE work (§20)</th>
                <td className="mono">
                  {cpu.product.metrics.mul16} × 16-bit multiplies · {cpu.product.metrics.add32} adds
                  · {cpu.product.metrics.modeledCycles} cycles
                </td>
              </tr>
            </>
          )}
          {op === 'divRem' && cpu.division !== undefined && (
            <>
              <tr>
                <th scope="row">Quotient</th>
                <td className="mono">{describeWideLiteral(fromLimbs(cpu.division.quotient))}</td>
              </tr>
              <tr>
                <th scope="row">Remainder</th>
                <td className="mono">
                  {describeWideLiteral(fromLimbs(cpu.division.remainder))}
                  <br />
                  <small>
                    A = Q × B + R holds, and R needs no thirty-third limb: it stays below B
                  </small>
                </td>
              </tr>
              <tr>
                <th scope="row">DIV_REM work (§20)</th>
                <td className="mono">
                  {cpu.division.metrics.add32} adds · {cpu.division.metrics.compare32} compares ·{' '}
                  {cpu.division.metrics.modeledCycles} cycles
                </td>
              </tr>
            </>
          )}
          {/* §21's two-machines cross-check is about the product, so it belongs
              under the product. It used to sit under every operation, which put
              a verdict about a multiply beneath a picture of a subtraction —
              the same mistake the GPU row was written to avoid. */}
          {op === 'mulWide' && (
            <tr>
              <th scope="row">Same product, two machines</th>
              <td className="mono">
                {productsAgree ? (
                  <span className="tag tag-exact">agree bit-for-bit</span>
                ) : (
                  <span className="error">disagree — one machine is wrong</span>
                )}
                <br />
                <small>
                  limb machine {cpu.product.metrics.mul16} × 16-bit multiplies,{' '}
                  {cpu.product.metrics.modeledCycles} cycles · digit machine at {digitBits}-bit
                  digits, {digitCycles} cycles
                </small>
              </td>
            </tr>
          )}
          {/* Likewise the GPU verdict: the §17 organizations checked here are
              organizations of ADD, and a claim about them under any other
              operation would be a claim about something not on screen. */}
          {op === 'add' && (
            <tr>
              <th scope="row">GPU</th>
              <td className="mono">
                {gpu.kind === 'checking' && <small>asking this browser for a device…</small>}
                {gpu.kind === 'absent' && (
                  <small>
                    no WebGPU device in this browser — everything above is the CPU simulation, and
                    nothing on this page has been GPU-verified
                  </small>
                )}
                {gpu.kind === 'agrees' && (
                  <>
                    <span className="tag tag-exact">ADD agrees with the CPU machine</span>{' '}
                    <small>
                      checked bit-for-bit on these operands · {gpu.description}
                      <br />
                      all {ADD_ORGANIZATIONS.length} §17 organizations of ADD: one thread owning 32
                      limbs, 32 lanes owning one each with the carry resolved by a 5-round scan, and
                      8 lanes of 4 limbs rippling inside and scanning across in 3
                    </small>
                  </>
                )}
                {gpu.kind === 'disagrees' && (
                  <span className="error">
                    the GPU and CPU machines disagree on these operands ({gpu.description}) — per
                    §19, neither is trusted until this is explained
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {/* This used to say "the dots are those carries" whatever the selector
          said, which stopped being true the moment there was a selector. The
          part about the dialect is true of every op; the part about what the
          dots are is not. */}
      <p className="lens-question">
        A shader owns this register as <code>array&lt;u32, 32&gt;</code>: no 64-bit integers, so
        even one partial product is four 16-bit multiplies, and no way to ask whether an addition
        overflowed — a carry is detected by noticing the sum came out smaller than an operand, and a
        borrow by noticing the difference came out larger. Whatever this operation puts between its
        lanes comes from the kernel&rsquo;s own trace rather than from a second implementation of
        the rule here. The lanes hold magnitudes: sign lives at the boundary, not in the lanes (§6).
      </p>
    </section>
  );
}
