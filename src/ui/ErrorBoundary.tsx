/**
 * A per-lens error boundary.
 *
 * React asked for one out loud during milestone 6, when a crash in the Ruler
 * took the whole page down. A lens that throws should cost you that lens, not
 * the app — and it should say what happened rather than leaving a white screen
 * to be interpreted.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** Named in the fallback, so the reader knows which part failed. */
  label: string;
  children: ReactNode;
  /** Called with the error, for tests and for future reporting. */
  onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;

    return (
      // `data-lens-failed` is for `e2e/conformance.spec.ts`. A lens that fell
      // back to this draws almost nothing, so every geometric rule in the sweep
      // passes for want of anything to check — which is how a scenario the UI
      // offers went on replacing the whole Architecture Lab with an apology
      // while the sweep called that state clean. Matching an attribute rather
      // than the heading text keeps the rule from depending on the wording.
      <section className="panel" role="alert" data-lens-failed="">
        <h3>{this.props.label} could not be drawn</h3>
        <p className="error">{error.message}</p>
        <p className="lens-question">
          The other lenses are unaffected — pick one from the navigation above. If you arrived here
          from a shared link, the view it described may not be one this build can produce.
        </p>
      </section>
    );
  }
}
