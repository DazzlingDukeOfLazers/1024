// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Tells React that `act` is expected here, which suppresses its warning about
// updates outside an act-aware environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

function render(node: React.ReactNode): void {
  const root = createRoot(container);
  act(() => root.render(node));
}

describe('when nothing goes wrong', () => {
  it('renders its children untouched', () => {
    render(
      <ErrorBoundary label="Metric Ruler">
        <p>the ruler</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('the ruler');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('when a lens throws', () => {
  beforeEach(() => {
    // React logs the caught error; the test is about the boundary, not the noise.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows what failed instead of a white screen', () => {
    render(
      <ErrorBoundary label="Metric Ruler">
        <Boom message="camera centre is not a rational" />
      </ErrorBoundary>,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Metric Ruler could not be drawn');
    expect(alert?.textContent).toContain('camera centre is not a rational');
  });

  it('marks itself so the conformance sweep can tell blank from clean', () => {
    // `e2e/conformance.spec.ts` rule 6 finds a failed lens by this attribute.
    // Every other rule there is a statement about something drawn, so without a
    // marker a lens that drew nothing passes them all. Dropping the attribute
    // would disable that rule silently, which is why it is asserted here rather
    // than only relied on there.
    render(
      <ErrorBoundary label="Comparator">
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(container.querySelector('[data-lens-failed]')).not.toBeNull();
  });

  it('says the other lenses still work, because they do', () => {
    render(
      <ErrorBoundary label="Scale Atlas">
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('The other lenses are unaffected');
  });

  it('points at a shared link as a likely cause, since that is one', () => {
    render(
      <ErrorBoundary label="Comparator">
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('shared link');
  });

  it('reports the error to its caller', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary label="Lab" onError={onError}>
        <Boom message="something specific" />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('something specific');
  });

  it('contains the failure rather than letting it escape', () => {
    render(
      <div>
        <p>sibling content</p>
        <ErrorBoundary label="Lab">
          <Boom message="nope" />
        </ErrorBoundary>
      </div>,
    );

    // The point of the boundary: everything outside it survived.
    expect(container.textContent).toContain('sibling content');
    expect(container.textContent).toContain('could not be drawn');
  });
});
