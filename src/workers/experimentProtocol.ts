/**
 * The experiment worker protocol.
 *
 * docs/ARCHITECTURE.md has claimed since milestone 4 that the runner is
 * "worker-ready" — pure, chunked, with a plain `{aborted}` signal. This is the
 * module that either proves that or exposes it as wishful thinking.
 *
 * Messages cross as the JSON forms the trace serializer already defines, so
 * exact values travel as strings rather than relying on `structuredClone`
 * carrying BigInt. That path is tested; a second one would not be.
 *
 * The message handling lives here, apart from the worker entry point, so it can
 * be tested without a `Worker` at all.
 */

import { type ExperimentDefinitionJSON, experimentFromJSON } from '../core/experiments/steps';
import { runExperiment } from '../core/experiments/runner';
import { type ExperimentResultJSON, resultToJSON } from '../core/experiments/trace';

export interface RunRequest {
  readonly type: 'run';
  readonly definition: ExperimentDefinitionJSON;
  readonly chunkSize?: number;
}

export type WorkerRequest = RunRequest;

export type WorkerResponse =
  | {
      readonly type: 'progress';
      readonly stepIndex: number;
      readonly iteration: number;
      readonly count: number;
    }
  | { readonly type: 'done'; readonly result: ExperimentResultJSON }
  | { readonly type: 'failed'; readonly message: string };

/**
 * Run one request and report through `post`.
 *
 * Progress can be posted from inside the loop; incoming messages cannot be
 * *read* from inside it, because the worker's own message queue is blocked
 * while it computes. Cancellation is therefore termination, from the other
 * side — which is safe precisely because the runner has no side effects.
 */
export function handleRequest(
  request: WorkerRequest,
  post: (response: WorkerResponse) => void,
): void {
  try {
    const definition = experimentFromJSON(request.definition);
    const result = runExperiment(definition, {
      ...(request.chunkSize === undefined ? {} : { chunkSize: request.chunkSize }),
      onProgress: (progress) =>
        post({
          type: 'progress',
          stepIndex: progress.stepIndex,
          iteration: progress.iteration,
          count: progress.count,
        }),
    });
    post({ type: 'done', result: resultToJSON(result) });
  } catch (error) {
    post({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}
