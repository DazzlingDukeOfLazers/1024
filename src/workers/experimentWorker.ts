/// <reference lib="webworker" />

/**
 * The experiment worker entry point.
 *
 * Deliberately almost empty: everything that could be got wrong lives in
 * `experimentProtocol.ts`, where it can be tested without a `Worker`.
 */

import { type WorkerRequest, handleRequest } from './experimentProtocol';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handleRequest(event.data, (response) => self.postMessage(response));
};
