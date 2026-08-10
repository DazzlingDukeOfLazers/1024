import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// The bridge src/gpu/expose.ts installs. Declared here as well because the
// e2e program and the app program are separate TypeScript projects, and a
// page.evaluate boundary is exactly where their types meet.
declare global {
  interface Window {
    scaleAtlasCompute?: {
      probe(): Promise<{ available: boolean; description?: string }>;
      run(
        op: 'add' | 'sub' | 'bitlen' | 'shl' | 'shr' | 'mulWide' | 'divRem',
        a: string,
        b?: string,
        shift?: number,
      ): Promise<Record<string, string | number | boolean>>;
    };
  }
}

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

test('the compute panel reports agreement where a device exists', async ({ page }) => {
  test.skip(process.env['CI'] !== undefined, 'GPU verification runs on the dev box only');
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  const gpuRow = page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: 'GPU', exact: true }) });
  // The check is asynchronous; the assertion retries until the device answers.
  await expect(gpuRow).toContainText('ADD agrees with the CPU machine', { timeout: 20000 });
  await expect(gpuRow).toContainText('checked bit-for-bit on these operands');
  // §17: the panel claims three organizations, so three have to have run.
  await expect(gpuRow).toContainText('all 3 §17 organizations of ADD');
  await expect(gpuRow).toContainText('32 lanes owning one each');
  await expect(gpuRow).toContainText('8 lanes of 4 limbs');
  if (process.env['SHOTS'] !== undefined) {
    // The only way to see this row: it needs a real device, so the ordinary
    // screenshot sweep renders the "absent" branch instead.
    await page.screenshot({ path: 'shots/gpu-verdict.png', fullPage: true });
  }
});

test('every limb fixture passes on the actual GPU (§18, §19)', async ({ page }) => {
  test.skip(process.env['CI'] !== undefined, 'GPU verification runs on the dev box only');
  // Serial WGSL division on 202 cases takes real wall clock; give it room.
  test.setTimeout(240_000);
  await page.goto('/');

  const limbs = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/oracle.json', import.meta.url)), 'utf-8'),
  ).limbs as {
    add: { a: string; b: string; sum: string; carryOut: boolean }[];
    sub: { a: string; b: string; difference: string; borrowOut: boolean }[];
    bitlen: { value: string; bitLength: number }[];
    shl: { value: string; shift: number; result: string }[];
    shr: { value: string; shift: number; result: string }[];
    mulWide: { a: string; b: string; product: string }[];
    divRem: { dividend: string; divisor: string; quotient: string; remainder: string }[];
  };

  const probe = await page.evaluate(() => window.scaleAtlasCompute!.probe());
  if (!probe.available) {
    test.skip(true, 'adapter or device unavailable — §18 is UNVERIFIED in this run');
  }
  console.log(`GPU under test: ${probe.description}`);

  // One evaluate per op batch: the round trip is the slow part, not the GPU.
  const runBatch = (
    op: string,
    cases: { a: string; b?: string; shift?: number }[],
  ): Promise<Record<string, string | number | boolean>[]> =>
    page.evaluate(
      async ({ op, cases }) => {
        const bridge = window.scaleAtlasCompute!;
        const results = [];
        for (const item of cases) {
          results.push(
            await bridge.run(op as Parameters<typeof bridge.run>[0], item.a, item.b, item.shift),
          );
        }
        return results;
      },
      { op, cases },
    );

  let checked = 0;

  const additions = await runBatch(
    'add',
    limbs.add.map((entry) => ({ a: entry.a, b: entry.b })),
  );
  limbs.add.forEach((entry, index) => {
    expect(additions[index], `add ${entry.a} + ${entry.b}`).toEqual({
      sum: entry.sum,
      carryOut: entry.carryOut,
    });
    checked += 1;
  });

  // §17: the same operation with one lane per limb and the carry resolved by a
  // parallel scan, against the same fixtures. A second organization is only
  // worth having if it is checked, and the check is against the CPU's expected
  // sums — not against the serial shader, which would make the GPU its own
  // reference (§19).
  for (const organization of ['addLanes', 'addBlocks'] as const) {
    const results = await runBatch(
      organization,
      limbs.add.map((entry) => ({ a: entry.a, b: entry.b })),
    );
    limbs.add.forEach((entry, index) => {
      expect(results[index], `${organization} ${entry.a} + ${entry.b}`).toEqual({
        sum: entry.sum,
        carryOut: entry.carryOut,
      });
      // And every organization agrees with every other, which the fixture
      // comparison already implies and which is the claim §17 actually makes.
      expect(
        results[index],
        `${organization} disagrees with the serial kernel on ${entry.a} + ${entry.b}`,
      ).toEqual(additions[index]);
      checked += 1;
    });
  }

  const subtractions = await runBatch(
    'sub',
    limbs.sub.map((entry) => ({ a: entry.a, b: entry.b })),
  );
  limbs.sub.forEach((entry, index) => {
    expect(subtractions[index], `sub ${entry.a} − ${entry.b}`).toEqual({
      difference: entry.difference,
      borrowOut: entry.borrowOut,
    });
    checked += 1;
  });

  // The same lane scan carrying a borrow. It shares the network with the ADD
  // kernel, so a fault in the scan shows up in two places at once — but only if
  // both are swept.
  const borrowScan = await runBatch(
    'subLanes',
    limbs.sub.map((entry) => ({ a: entry.a, b: entry.b })),
  );
  limbs.sub.forEach((entry, index) => {
    expect(borrowScan[index], `subLanes ${entry.a} − ${entry.b}`).toEqual({
      difference: entry.difference,
      borrowOut: entry.borrowOut,
    });
    expect(
      borrowScan[index],
      `subLanes disagrees with the serial kernel on ${entry.a} − ${entry.b}`,
    ).toEqual(subtractions[index]);
    checked += 1;
  });

  const lengths = await runBatch(
    'bitlen',
    limbs.bitlen.map((entry) => ({ a: entry.value })),
  );
  limbs.bitlen.forEach((entry, index) => {
    expect(lengths[index], `bitlen ${entry.value}`).toEqual({ bitLength: entry.bitLength });
    checked += 1;
  });

  const lefts = await runBatch(
    'shl',
    limbs.shl.map((entry) => ({ a: entry.value, shift: entry.shift })),
  );
  limbs.shl.forEach((entry, index) => {
    expect(lefts[index], `${entry.value} << ${entry.shift}`).toEqual({ result: entry.result });
    checked += 1;
  });

  const rights = await runBatch(
    'shr',
    limbs.shr.map((entry) => ({ a: entry.value, shift: entry.shift })),
  );
  limbs.shr.forEach((entry, index) => {
    expect(rights[index], `${entry.value} >> ${entry.shift}`).toEqual({ result: entry.result });
    checked += 1;
  });

  const products = await runBatch(
    'mulWide',
    limbs.mulWide.map((entry) => ({ a: entry.a, b: entry.b })),
  );
  limbs.mulWide.forEach((entry, index) => {
    expect(products[index], `mul ${entry.a} × ${entry.b}`).toEqual({ product: entry.product });
    checked += 1;
  });

  const divisions = await runBatch(
    'divRem',
    limbs.divRem.map((entry) => ({ a: entry.dividend, b: entry.divisor })),
  );
  limbs.divRem.forEach((entry, index) => {
    expect(divisions[index], `div ${entry.dividend} ÷ ${entry.divisor}`).toEqual({
      quotient: entry.quotient,
      remainder: entry.remainder,
    });
    checked += 1;
  });

  // Anti-vacuity: a sweep that swept nothing proves nothing.
  expect(checked).toBeGreaterThan(190);
  console.log(`GPU fixture cases checked bit-for-bit: ${checked}`);
});
