import { useState } from 'react';
import { LENSES, type LensId } from './ui/lenses';
import { LabView } from './ui/LabView';
import { ComparatorView } from './features/comparator/ComparatorView';
import { RulerView } from './features/ruler/RulerView';
import { AtlasView } from './features/atlas/AtlasView';
import { CATALOG } from './catalog/catalog';

/**
 * Milestone 0–7 app shell.
 *
 * Selection lives here rather than inside a lens, because docs/UI_SPEC.md wants
 * it to survive the jump from Atlas to Ruler. The Microscope is still a
 * placeholder; docs/IMPLEMENTATION_PLAN.md builds it in milestone 10.
 */
export function App() {
  const [lens, setLens] = useState<LensId>('atlas');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const active = LENSES.find((entry) => entry.id === lens) ?? LENSES[0];
  const selected = selectedId === undefined ? undefined : CATALOG.get(selectedId);

  const openInRuler = (id: string): void => {
    setSelectedId(id);
    setLens('ruler');
  };

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

        {selected !== undefined && (
          <p className="selection-banner">
            Selected: <strong>{selected.name}</strong>
            <button type="button" onClick={() => setSelectedId(undefined)}>
              clear
            </button>
          </p>
        )}

        {lens === 'atlas' ? (
          <AtlasView selectedId={selectedId} onSelect={setSelectedId} onOpenInRuler={openInRuler} />
        ) : lens === 'ruler' ? (
          // Keyed on the selection so choosing a new object re-frames the
          // camera on it, rather than needing an effect to chase the prop.
          <RulerView key={selectedId ?? 'none'} focusObjectId={selectedId} />
        ) : lens === 'comparator' ? (
          <ComparatorView initialObjectId={selectedId} />
        ) : lens === 'lab' ? (
          <LabView />
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
