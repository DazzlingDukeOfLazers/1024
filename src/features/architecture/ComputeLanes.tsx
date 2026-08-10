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
import { LIMBS_PER_VALUE, addLimbs, fromLimbs, mulLimbs, toLimbs } from '../../core/limbs/limbs';
import { createGpuLimbMachine } from '../../gpu/harness';
import { describeWideLiteral } from '../../core/wide/parse';
import { useMeasuredWidth } from '../../ui/useMeasuredWidth';

const NOMINAL_WIDTH = 820;
const LANE_HEIGHT = 84;
const LABEL_FONT_SIZE = 9;

type GpuVerdict =
  | { readonly kind: 'checking' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'agrees'; readonly description: string }
  | { readonly kind: 'disagrees'; readonly description: string };

/** One row of 32 lanes, with a marker at every boundary that carried. */
function LaneStrip({ sum, carries }: { sum: Uint32Array; carries: Uint8Array }) {
  const [width, measure] = useMeasuredWidth(NOMINAL_WIDTH);
  const gap = 2;
  const cell = Math.max((width - gap * (LIMBS_PER_VALUE - 1)) / LIMBS_PER_VALUE, 1);
  const carriedCount = carries.reduce((total, lane) => total + lane, 0);

  return (
    <div ref={measure}>
      <svg
        viewBox={`0 0 ${width} ${LANE_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Sum lanes: ${carriedCount} of ${LIMBS_PER_VALUE} lanes emitted a carry`}
      >
        <text x={0} y={12} fontSize={LABEL_FONT_SIZE} fill="currentColor" fillOpacity={0.6}>
          A + B, lane 31 down to lane 0
        </text>
        {Array.from(sum)
          .reverse()
          .map((limb, index) => {
            const lane = LIMBS_PER_VALUE - 1 - index;
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
                {carries[lane] === 1 && (
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
          dot: the lane emitted a carry
        </text>
      </svg>
    </div>
  );
}

export interface ComputeLanesProps {
  /** Magnitudes, both below 2^1024 — sign belongs to the boundary (§6). */
  readonly a: bigint;
  readonly b: bigint;
  /** The digit machine's product of the same operands, for the §21 row. */
  readonly digitProduct: bigint;
  readonly digitCycles: number;
  readonly digitBits: number;
}

export function ComputeLanes({ a, b, digitProduct, digitCycles, digitBits }: ComputeLanesProps) {
  const cpu = useMemo(() => {
    const aLimbs = toLimbs(a);
    const bLimbs = toLimbs(b);
    const sum = addLimbs(aLimbs, bLimbs, true);
    const product = mulLimbs(aLimbs, bLimbs);
    // Longest unbroken run of carrying lanes: the §19 "long carry chain",
    // measured on the actual operands. Presentation counting, not arithmetic.
    let longestChain = 0;
    let run = 0;
    for (const lane of sum.carries!) {
      run = lane === 1 ? run + 1 : 0;
      longestChain = Math.max(longestChain, run);
    }
    return { aLimbs, bLimbs, sum, product, longestChain };
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
        const matches = async (organization: 'add' | 'addLanes'): Promise<boolean> => {
          const out = await machine.run(organization, cpu.aLimbs, cpu.bLimbs);
          return (
            cpu.sum.limbs.every((limb, index) => out[index] === limb) &&
            (out[32] === 1) === cpu.sum.carryOut
          );
        };
        const serial = await matches('add');
        const lanes = await matches('addLanes');
        conclude(
          serial && lanes
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

  return (
    <section className="panel">
      <h3>The same register, as 32 × u32 lanes</h3>
      <LaneStrip sum={cpu.sum.limbs} carries={cpu.sum.carries!} />
      <table className="readout">
        <tbody>
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
                    both §17 organizations: one thread owning all 32 limbs, and 32 lanes owning one
                    limb each with the carry resolved by a parallel scan
                  </small>
                </>
              )}
              {gpu.kind === 'disagrees' && (
                <span className="error">
                  the GPU and CPU machines disagree on these operands ({gpu.description}) — per §19,
                  neither is trusted until this is explained
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="lens-question">
        A shader owns this register as <code>array&lt;u32, 32&gt;</code>: no 64-bit integers, so
        even one partial product is four 16-bit multiplies, and no way to ask whether an addition
        overflowed — a carry is detected by noticing the sum came out smaller than an operand. The
        dots are those carries, from the kernel&rsquo;s own trace. Everything here is the magnitude
        |A| + |B|: sign lives at the boundary, not in the lanes (§6).
      </p>
    </section>
  );
}
