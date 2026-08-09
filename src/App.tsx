import { useState } from 'react';
import { LENSES, type LensId } from './ui/lenses';
import { LabView } from './ui/LabView';
import { ComparatorView } from './features/comparator/ComparatorView';

/**
 * Milestone 0–2 app shell.
 *
 * Four lenses are placeholders on purpose — docs/IMPLEMENTATION_PLAN.md builds
 * them after the numerical core is trustworthy. Navigation state will move into
 * the versioned share-state schema in Milestone 8.
 */
export function App() {
  const [lens, setLens] = useState<LensId>('lab');
  const active = LENSES.find((entry) => entry.id === lens) ?? LENSES[0];

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Scale Atlas / Numerical Microscope</h1>
        <p className="app-tagline">We have an irresponsible amount of coordinate space.</p>
        <nav className="lens-nav" aria-label="Lenses">
          {LENSES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLens(entry.id)}
              aria-current={entry.id === lens ? 'page' : undefined}
            >
              {entry.title}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <h2 className="app-title">{active?.title}</h2>
        <p className="lens-question">{active?.question}</p>

        {lens === 'lab' ? (
          <LabView />
        ) : lens === 'comparator' ? (
          <ComparatorView />
        ) : (
          <p className="placeholder">
            Not built yet — see docs/IMPLEMENTATION_PLAN.md for the milestone that delivers this
            lens.
          </p>
        )}
      </main>
    </div>
  );
}
