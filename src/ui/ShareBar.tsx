/**
 * The "Share this view" action.
 *
 * docs/UI_SPEC.md: a discovered numerical failure should be sendable as a link,
 * not as reproduction instructions. The link is a fragment, so no server is
 * involved and none can be.
 */

import { useEffect, useState } from 'react';
import { type AppState } from '../share/appState';
import { shareUrl } from '../share/url';

export interface ShareBarProps {
  state: AppState;
  /**
   * The state the address bar currently describes, from whichever of the two
   * things last made them agree: restoring a link, or sharing this view.
   */
  describedByUrl?: AppState | undefined;
  onShare: (state: AppState) => void;
  /** Reported when a link could not be restored. */
  restoreError?: string | undefined;
}

export function ShareBar({ state, describedByUrl, onShare, restoreError }: ShareBarProps) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const share = (): void => {
    const next = shareUrl(window.location.href, state);
    setUrl(next);
    setCopied(false);
    onShare(state);

    // Put it in the address bar too, so the browser's own copy works and a
    // reload restores the same view. replaceState keeps the back button sane.
    window.history.replaceState(null, '', next);

    void navigator.clipboard
      ?.writeText(next)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  /**
   * The address bar claims to describe the screen. The moment the view moves on
   * from what was shared, the fragment sitting in it describes something that is
   * no longer here — and a reload would silently restore that instead of this.
   * So it is removed rather than left looking current.
   *
   * The link itself survives, in the clipboard and in the field below, relabelled
   * so it is clear which view it is of. Every state update produces a new object,
   * so identity is the comparison.
   */
  const stale = describedByUrl !== undefined && describedByUrl !== state;
  useEffect(() => {
    // Only the address bar is touched here — no React state — so this runs once
    // on the transition rather than on every pan that follows it.
    if (!stale) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [stale]);

  return (
    <div className="share-bar">
      <button type="button" onClick={share}>
        Share this view
      </button>
      {url !== undefined && (
        <>
          <input readOnly value={url} aria-label="Share URL" onFocus={(e) => e.target.select()} />
          <span className="share-hint">
            {stale
              ? 'the view you shared, not the one on screen'
              : copied
                ? 'copied'
                : 'select to copy'}
          </span>
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
