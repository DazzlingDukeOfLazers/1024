/**
 * The "Share this view" action.
 *
 * docs/UI_SPEC.md: a discovered numerical failure should be sendable as a link,
 * not as reproduction instructions. The link is a fragment, so no server is
 * involved and none can be.
 */

import { useState } from 'react';
import { type AppState } from '../share/appState';
import { shareUrl } from '../share/url';

export interface ShareBarProps {
  state: AppState;
  /** Reported when a link could not be restored on load. */
  restoreError?: string | undefined;
}

export function ShareBar({ state, restoreError }: ShareBarProps) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const share = (): void => {
    const next = shareUrl(window.location.href, state);
    setUrl(next);
    setCopied(false);

    // Put it in the address bar too, so the browser's own copy works and a
    // reload restores the same view. replaceState keeps the back button sane.
    window.history.replaceState(null, '', next);

    void navigator.clipboard
      ?.writeText(next)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="share-bar">
      <button type="button" onClick={share}>
        Share this view
      </button>
      {url !== undefined && (
        <>
          <input readOnly value={url} aria-label="Share URL" onFocus={(e) => e.target.select()} />
          <span className="share-hint">{copied ? 'copied' : 'select to copy'}</span>
        </>
      )}
      {restoreError !== undefined && (
        <span className="error" role="status">
          Could not restore that link: {restoreError}
        </span>
      )}
    </div>
  );
}
