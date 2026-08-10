/**
 * The §19 verification surface.
 *
 * `e2e/webgpu.spec.ts` drives every limb fixture through the real GPU, and it
 * needs a way to reach the harness from `page.evaluate`. This is that way: a
 * frozen namespace on `window`, taking and returning decimal strings because
 * that is what survives the evaluate boundary, converting at the edges with
 * the same `toLimbs`/`fromLimbs` the CPU machine uses.
 *
 * It is a diagnostics surface, not an API: nothing in the app reads it, it
 * holds no state beyond a lazily created machine, and the answers it returns
 * are the GPU's own — checking them is the caller's job, per §19.
 */

import { fromLimbs, toLimbs } from '../core/limbs/limbs';
import {
  type GpuLimbMachine,
  type LimbOp,
  type LimbOrganization,
  createGpuLimbMachine,
} from './harness';

export interface GpuProbeResult {
  readonly available: boolean;
  readonly description?: string;
}

interface ComputeBridge {
  probe(): Promise<GpuProbeResult>;
  /**
   * Run one op. `a`, `b` are decimal strings; the result is decimal strings in
   * the fixture's own field names, so the sweep compares like for like.
   */
  run(
    op: LimbOp | LimbOrganization,
    a: string,
    b?: string,
    shift?: number,
  ): Promise<Record<string, string | number | boolean>>;
}

declare global {
  interface Window {
    scaleAtlasCompute?: ComputeBridge;
  }
}

let machine: GpuLimbMachine | undefined;
let probed = false;

async function ensureMachine(): Promise<GpuLimbMachine | undefined> {
  if (!probed) {
    machine = await createGpuLimbMachine();
    probed = true;
  }
  return machine;
}

const low = (limbs: Uint32Array, from: number, count: number): Uint32Array =>
  limbs.subarray(from, from + count);

export function exposeComputeBridge(): void {
  if (typeof window === 'undefined') return;
  window.scaleAtlasCompute = Object.freeze({
    async probe(): Promise<GpuProbeResult> {
      const found = await ensureMachine();
      return found === undefined
        ? { available: false }
        : { available: true, description: found.description };
    },

    async run(op: LimbOp | LimbOrganization, a: string, b?: string, shift?: number) {
      const found = await ensureMachine();
      if (found === undefined) throw new Error('no GPU limb machine here');
      const aLimbs = toLimbs(BigInt(a));
      const bLimbs = b === undefined ? undefined : toLimbs(BigInt(b));
      const out = await found.run(op, aLimbs, bLimbs, shift);

      switch (op) {
        // Both organizations answer in the fixture's own field names, so the
        // sweep compares them against the same expectation without knowing
        // which one it ran.
        case 'add':
        case 'addLanes':
        case 'addBlocks':
          return { sum: fromLimbs(low(out, 0, 32)).toString(), carryOut: out[32] === 1 };
        case 'sub':
          return { difference: fromLimbs(low(out, 0, 32)).toString(), borrowOut: out[32] === 1 };
        case 'bitlen':
          return { bitLength: out[0]! };
        case 'shl':
        case 'shr':
          return { result: fromLimbs(low(out, 0, 32)).toString() };
        case 'mulWide':
          return { product: fromLimbs(low(out, 0, 64)).toString() };
        case 'divRem':
          return {
            quotient: fromLimbs(low(out, 0, 32)).toString(),
            remainder: fromLimbs(low(out, 32, 32)).toString(),
          };
      }
    },
  });
}
