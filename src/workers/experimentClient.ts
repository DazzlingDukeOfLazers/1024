/**
 * Main-thread client for the experiment worker.
 *
 * A million-step experiment is about a second and a half of solid BigInt
 * arithmetic. On the main thread that is a frozen tab; here it is a progress
 * bar, and cancelling is immediate because terminating the worker is safe —
 * the runner has no side effects to unwind.
 *
 * The worker factory is injectable so the protocol can be exercised in a test
 * environment that has no `Worker` at all.
 */

import { type ExperimentDefinition, experimentToJSON } from '../core/experiments/steps';
import { type ExperimentResult } from '../core/experiments/runner';
import { resultFromJSON } from '../core/experiments/trace';
import { type WorkerRequest, type WorkerResponse } from './experimentProtocol';

/** The slice of `Worker` this client uses. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

export interface RunProgress {
  readonly stepIndex: number;
  readonly iteration: number;
  readonly count: number;
}

export interface RunHandle {
  readonly result: Promise<ExperimentResult>;
  /** Stop immediately. The promise rejects with a cancellation. */
  cancel(): void;
}

export class ExperimentCancelled extends Error {
  constructor() {
    super('Experiment cancelled');
    this.name = 'ExperimentCancelled';
  }
}

export function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./experimentWorker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export interface RunInWorkerOptions {
  onProgress?: ((progress: RunProgress) => void) | undefined;
  chunkSize?: number | undefined;
  createWorker?: WorkerFactory | undefined;
}

export function runExperimentInWorker(
  definition: ExperimentDefinition,
  options: RunInWorkerOptions = {},
): RunHandle {
  const worker = (options.createWorker ?? defaultWorkerFactory)();
  let settled = false;
  let abandon: ((reason: unknown) => void) | undefined;

  const stop = (): void => {
    settled = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  };

  const result = new Promise<ExperimentResult>((resolve, reject) => {
    // The executor runs synchronously, so `cancel` can always reach this.
    abandon = reject;

    worker.onmessage = (event) => {
      const response = event.data;
      if (response.type === 'progress') {
        options.onProgress?.(response);
        return;
      }
      if (settled) return;
      if (response.type === 'done') {
        stop();
        resolve(resultFromJSON(response.result));
      } else {
        stop();
        reject(new Error(response.message));
      }
    };

    worker.onerror = (event) => {
      if (settled) return;
      stop();
      reject(new Error(event.message ?? 'The experiment worker failed'));
    };

    worker.postMessage({
      type: 'run',
      definition: experimentToJSON(definition),
      ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
    });
  });

  return {
    result,
    cancel() {
      if (settled) return;
      stop();
      // Terminating alone would leave the promise pending forever.
      abandon?.(new ExperimentCancelled());
    },
  };
}
