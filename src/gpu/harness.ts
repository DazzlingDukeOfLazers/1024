/**
 * The WebGPU harness: buffers, pipelines, dispatch, readback. §18.
 *
 * The design rule is §19's: the GPU is never its own correctness reference.
 * This module runs kernels and returns bits; deciding whether the bits are
 * right belongs to the caller, against the CPU machine or the committed
 * fixtures. Nothing here rounds, retries, or repairs.
 *
 * Availability is a fact to report, not to hide: `createGpuLimbMachine`
 * resolves to `undefined` where WebGPU is missing (most CI, some browsers) and
 * the caller says so out loud. On this project's dev machine the environment
 * that actually works is branded Chrome with `--enable-unsafe-webgpu
 * --enable-gpu`; Playwright's bundled Chromium finds the adapter and then
 * fails device creation on a missing dxil.dll — see `e2e/webgpu.spec.ts`.
 */

import { LIMBS_PER_VALUE } from '../core/limbs/limbs';
import { ADD_WGSL, BITLEN_WGSL, DIVREM_WGSL, MUL_WGSL, SHL_WGSL, SHR_WGSL, SUB_WGSL } from './wgsl';

export type LimbOp = 'add' | 'sub' | 'bitlen' | 'shl' | 'shr' | 'mulWide' | 'divRem';

interface OpShape {
  readonly source: string;
  /** Whether the kernel reads a second operand buffer. */
  readonly takesB: boolean;
  /** Whether the kernel takes the uniform shift. */
  readonly takesShift: boolean;
  /** u32s in the output buffer. */
  readonly outWords: number;
}

const SHAPES: Record<LimbOp, OpShape> = {
  add: { source: ADD_WGSL, takesB: true, takesShift: false, outWords: 33 },
  sub: { source: SUB_WGSL, takesB: true, takesShift: false, outWords: 33 },
  bitlen: { source: BITLEN_WGSL, takesB: false, takesShift: false, outWords: 1 },
  shl: { source: SHL_WGSL, takesB: false, takesShift: true, outWords: 32 },
  shr: { source: SHR_WGSL, takesB: false, takesShift: true, outWords: 32 },
  mulWide: { source: MUL_WGSL, takesB: true, takesShift: false, outWords: 64 },
  divRem: { source: DIVREM_WGSL, takesB: true, takesShift: false, outWords: 65 },
};

export interface GpuLimbMachine {
  readonly description: string;
  /** Raw kernel output; the shape is the op's contract, documented in wgsl.ts. */
  run(op: LimbOp, a: Uint32Array, b?: Uint32Array, shift?: number): Promise<Uint32Array>;
  destroy(): void;
}

export async function createGpuLimbMachine(): Promise<GpuLimbMachine | undefined> {
  if (typeof navigator === 'undefined' || navigator.gpu === undefined) return undefined;
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) return undefined;
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch {
    // The adapter exists but cannot make a device — the dxil.dll case. Absent
    // and broken get the same honest answer: no machine.
    return undefined;
  }

  const info = adapter.info;
  const description =
    [info.vendor, info.architecture, info.description].filter((part) => part !== '').join(' · ') ||
    'unnamed adapter';

  const pipelines = new Map<LimbOp, GPUComputePipeline>();
  const pipelineFor = (op: LimbOp): GPUComputePipeline => {
    const existing = pipelines.get(op);
    if (existing !== undefined) return existing;
    const module = device.createShaderModule({ code: SHAPES[op].source });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    pipelines.set(op, pipeline);
    return pipeline;
  };

  const upload = (data: Uint32Array): GPUBuffer => {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Copied into a fresh ArrayBuffer-backed view: @webgpu/types refuses the
    // ArrayBufferLike-generic Uint32Array TypeScript now infers, and the copy
    // is 128 bytes.
    device.queue.writeBuffer(buffer, 0, new Uint32Array(data));
    return buffer;
  };

  return {
    description,

    async run(op, a, b, shift) {
      const shape = SHAPES[op];
      if (a.length !== LIMBS_PER_VALUE) {
        throw new Error(`${op} operand a has ${a.length} limbs`);
      }
      if (shape.takesB !== (b !== undefined)) {
        throw new Error(`${op} ${shape.takesB ? 'needs' : 'does not take'} operand b`);
      }
      if (shape.takesShift !== (shift !== undefined)) {
        throw new Error(`${op} ${shape.takesShift ? 'needs' : 'does not take'} a shift`);
      }

      const scratch: GPUBuffer[] = [];
      try {
        const entries: GPUBindGroupEntry[] = [];
        const aBuffer = upload(a);
        scratch.push(aBuffer);
        entries.push({ binding: 0, resource: { buffer: aBuffer } });

        if (b !== undefined) {
          if (b.length !== LIMBS_PER_VALUE) {
            throw new Error(`${op} operand b has ${b.length} limbs`);
          }
          const bBuffer = upload(b);
          scratch.push(bBuffer);
          entries.push({ binding: 1, resource: { buffer: bBuffer } });
        }

        const outBuffer = device.createBuffer({
          size: shape.outWords * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        scratch.push(outBuffer);
        entries.push({ binding: 2, resource: { buffer: outBuffer } });

        if (shift !== undefined) {
          // Uniform buffers round up to 16 bytes; the kernel reads one u32.
          const shiftBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(shiftBuffer, 0, new Uint32Array([shift]));
          scratch.push(shiftBuffer);
          entries.push({ binding: 3, resource: { buffer: shiftBuffer } });
        }

        const readBuffer = device.createBuffer({
          size: shape.outWords * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        scratch.push(readBuffer);

        const pipeline = pipelineFor(op);
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries,
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(outBuffer, 0, readBuffer, 0, shape.outWords * 4);
        device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const result = new Uint32Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();

        if (op === 'divRem' && result[64] !== 0) {
          // The shader cannot throw, so the R ≤ 2^k − 1 theorem failing on the
          // GPU arrives as a flag — and a flagged result must never be usable.
          throw new Error('GPU DIV_REM invariant failed: the remainder outgrew the register');
        }
        return result;
      } finally {
        for (const buffer of scratch) buffer.destroy();
      }
    },

    destroy() {
      device.destroy();
    },
  };
}
