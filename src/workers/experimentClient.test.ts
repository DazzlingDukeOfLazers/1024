import { describe, expect, it, vi } from 'vitest';
import { type WorkerRequest, type WorkerResponse, handleRequest } from './experimentProtocol';
import {
  ExperimentCancelled,
  type RunProgress,
  type WorkerLike,
  runExperimentInWorker,
} from './experimentClient';
import { requireExperiment } from '../core/experiments/fixtures';
import { experimentToJSON } from '../core/experiments/steps';
import { runExperiment } from '../core/experiments/runner';
import { rational } from '../core/rational/rational';

const r = rational;

/**
 * A stand-in worker that runs the real protocol on the same thread. It proves
 * the message contract, not the threading — the threading is the browser's job
 * and the Playwright suite covers it.
 */
function fakeWorker(options: { defer?: boolean } = {}): WorkerLike & { terminated: boolean } {
  const worker: WorkerLike & { terminated: boolean } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    postMessage(request: WorkerRequest) {
      const deliver = (response: WorkerResponse) => {
        if (worker.terminated) return;
        worker.onmessage?.({ data: response });
      };
      if (options.defer === true) return;
      handleRequest(request, deliver);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

describe('the protocol', () => {
  it('returns a result that matches running on this thread', async () => {
    const definition = requireExperiment('large-offset');
    const direct = runExperiment(definition);

    const handle = runExperimentInWorker(definition, { createWorker: () => fakeWorker() });
    const viaWorker = await handle.result;

    expect(viaWorker.exactFinal).toEqual(direct.exactFinal);
    expect(viaWorker.totalOperations).toBe(direct.totalOperations);
    for (const machine of viaWorker.machines) {
      const same = direct.machines.find((entry) => entry.id === machine.id)!;
      expect(machine.final).toEqual(same.final);
      expect(machine.ledger).toEqual(same.ledger);
    }
  });

  it('carries exact values across the boundary without loss', async () => {
    // The reason the messages are the trace JSON rather than a raw postMessage:
    // the camera-style rationals in a ledger have to survive intact.
    const handle = runExperimentInWorker(requireExperiment('million-millimeters'), {
      createWorker: () => fakeWorker(),
    });
    const result = await handle.result;

    expect(result.exactFinal).toEqual(r(1000n));
    const q128 = result.machines.find((machine) => machine.id === 'q128.128@m')!;
    expect(q128.final.signedDivergence!.denominator).toBeGreaterThan(1n);
    expect(q128.operations).toBe(1_000_001);
  });

  it('reports progress from inside the run', async () => {
    const seen: RunProgress[] = [];
    const handle = runExperimentInWorker(requireExperiment('million-millimeters'), {
      createWorker: () => fakeWorker(),
      chunkSize: 250_000,
      onProgress: (progress) => seen.push(progress),
    });
    await handle.result;

    expect(seen.map((progress) => progress.iteration)).toEqual([
      250_000, 500_000, 750_000, 1_000_000,
    ]);
    expect(seen.every((progress) => progress.count === 1_000_000)).toBe(true);
  });

  it('reports a failure rather than hanging', async () => {
    const handle = runExperimentInWorker(
      { id: 'broken', name: 'broken', unit: 'furlongs', steps: [] },
      { createWorker: () => fakeWorker() },
    );
    await expect(handle.result).rejects.toThrow(/furlongs/);
  });

  it('surfaces a worker-level error', async () => {
    const worker = fakeWorker({ defer: true });
    const handle = runExperimentInWorker(requireExperiment('thirds'), {
      createWorker: () => worker,
    });
    worker.onerror?.({ message: 'worker exploded' });
    await expect(handle.result).rejects.toThrow('worker exploded');
  });
});

describe('cancellation', () => {
  it('terminates the worker and settles the promise', async () => {
    // Terminating alone would leave the caller waiting forever, which is worse
    // than the freeze the worker was meant to fix.
    const worker = fakeWorker({ defer: true });
    const handle = runExperimentInWorker(requireExperiment('million-millimeters'), {
      createWorker: () => worker,
    });

    handle.cancel();
    await expect(handle.result).rejects.toBeInstanceOf(ExperimentCancelled);
    expect(worker.terminated).toBe(true);
  });

  it('is safe to call twice, and after completion', async () => {
    const handle = runExperimentInWorker(requireExperiment('thirds'), {
      createWorker: () => fakeWorker(),
    });
    await handle.result;

    expect(() => {
      handle.cancel();
      handle.cancel();
    }).not.toThrow();
  });

  it('drops messages that arrive after cancelling', async () => {
    const worker = fakeWorker({ defer: true });
    const onProgress = vi.fn();
    const handle = runExperimentInWorker(requireExperiment('thirds'), {
      createWorker: () => worker,
      onProgress,
    });

    handle.cancel();
    worker.onmessage?.({ data: { type: 'progress', stepIndex: 0, iteration: 1, count: 1 } });

    await expect(handle.result).rejects.toBeInstanceOf(ExperimentCancelled);
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('the request shape', () => {
  it('sends the definition as its serializable form', () => {
    const sent: WorkerRequest[] = [];
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (request) => sent.push(request),
      terminate: () => undefined,
    };
    runExperimentInWorker(requireExperiment('million-millimeters'), {
      createWorker: () => worker,
      chunkSize: 1000,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('run');
    expect(sent[0]?.definition).toEqual(experimentToJSON(requireExperiment('million-millimeters')));
    expect(sent[0]?.chunkSize).toBe(1000);

    // Every exact value is a string, so nothing depends on BigInt surviving a
    // structured clone.
    expect(JSON.stringify(sent[0])).toContain('"numerator":"1"');
  });
});
