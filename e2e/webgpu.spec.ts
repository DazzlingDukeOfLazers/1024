import { expect, test } from '@playwright/test';

/**
 * Does this environment run WebGPU compute at all? The seed of §18's track.
 *
 * Findings from the spike this file preserves (2026-08-09, this machine):
 *
 *  - Playwright's bundled Chromium finds the adapter (AMD RDNA-3) but
 *    `requestDevice` dies with `DynamicLib.Open: dxil.dll Windows Error: 87` —
 *    the DXC compiler DLLs are not packaged next to its binary.
 *  - Branded Chrome (`channel: 'chrome'`) ships the DLLs, and with
 *    `--enable-unsafe-webgpu --enable-gpu` executes WGSL compute correctly
 *    headless: a carry-propagating u32 add returned exactly [0x0, 0x4] for
 *    [0xFFFFFFFF, 1] + [1, 2].
 *
 * So §18's real tests run under this configuration. On a machine without
 * branded Chrome or a GPU (CI, most containers) the test skips — loudly, so a
 * green run is never mistaken for a verified one.
 */

test.use({
  channel: 'chrome',
  launchOptions: {
    args: ['--enable-unsafe-webgpu', '--enable-gpu'],
  },
});

test('a carry propagates through a WGSL compute shader', async ({ page }) => {
  // This is an environment test about the dev box. On CI the branded-Chrome
  // channel may not exist at all, and a launch failure is a test failure rather
  // than a skip — so CI opts out deterministically instead of by luck.
  test.skip(process.env['CI'] !== undefined, 'GPU environment test runs on the dev box only');
  await page.goto('/');
  const report = await page.evaluate(async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const gpu = (navigator as any).gpu;
    if (gpu === undefined) return { skip: 'navigator.gpu missing' };
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return { skip: 'no WebGPU adapter' };
    let device;
    try {
      device = await adapter.requestDevice();
    } catch (error) {
      return { skip: `requestDevice failed: ${String(error)}` };
    }

    // u32 add with carry across two limbs — §18's first primitive.
    const module = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read> a: array<u32>;
        @group(0) @binding(1) var<storage, read> b: array<u32>;
        @group(0) @binding(2) var<storage, read_write> out: array<u32>;
        @compute @workgroup_size(1)
        fn main() {
          var carry: u32 = 0u;
          for (var i: u32 = 0u; i < arrayLength(&a); i = i + 1u) {
            let sum = a[i] + b[i];
            let c1 = select(0u, 1u, sum < a[i]);
            let sum2 = sum + carry;
            let c2 = select(0u, 1u, sum2 < sum);
            out[i] = sum2;
            carry = c1 + c2;
          }
        }
      `,
    });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    const aData = new Uint32Array([0xffffffff, 0x00000001]);
    const bData = new Uint32Array([0x00000001, 0x00000002]);
    const usage = (window as any).GPUBufferUsage;
    const make = (data: Uint32Array, flags: number) => {
      const buffer = device.createBuffer({ size: data.byteLength, usage: flags });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    const aBuf = make(aData, usage.STORAGE | usage.COPY_DST);
    const bBuf = make(bData, usage.STORAGE | usage.COPY_DST);
    const outBuf = device.createBuffer({
      size: aData.byteLength,
      usage: usage.STORAGE | usage.COPY_SRC,
    });
    const readBuf = device.createBuffer({
      size: aData.byteLength,
      usage: usage.COPY_DST | usage.MAP_READ,
    });

    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: aBuf } },
        { binding: 1, resource: { buffer: bBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, aData.byteLength);
    device.queue.submit([encoder.finish()]);
    await readBuf.mapAsync((window as any).GPUMapMode.READ);
    return { result: Array.from(new Uint32Array(readBuf.getMappedRange())) };
  });

  if ('skip' in report) {
    test.skip(true, `WebGPU unavailable here — ${report.skip}. §18 is UNVERIFIED in this run.`);
  }
  // 0xFFFFFFFF + 1 = 0 carry 1; 1 + 2 + carry = 4.
  expect(report).toEqual({ result: [0, 4] });
});
