import { useCallback, useState } from 'react';
import { LENSES, type LensId } from './ui/lenses';
import { ShareBar } from './ui/ShareBar';
import { LabView } from './ui/LabView';
import { ComparatorView } from './features/comparator/ComparatorView';
import { RulerView } from './features/ruler/RulerView';
import { AtlasView } from './features/atlas/AtlasView';
import { MicroscopeView } from './features/microscope/MicroscopeView';
import { rulerPresets } from './features/ruler/presets';
import { CATALOG } from './catalog/catalog';
import {
  type AppState,
  type AtlasState,
  type ComparatorState,
  type LabState,
  type MicroscopeState,
  type RepresentationState,
  type RulerState,
  defaultAppState,
} from './share/appState';
import { stateFromFragment } from './share/url';

/**
 * The view state at page load, read from the URL fragment once.
 *
 * A malformed link reports itself rather than quietly loading a different view
 * than the link described.
 */
const INITIAL: { state: AppState; error?: string } = (() => {
  try {
    const restored = stateFromFragment(window.location.hash);
    return restored === undefined ? { state: defaultAppState() } : { state: restored };
  } catch (error) {
    return {
      state: defaultAppState(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
})();

/**
 * Milestone 0–8 app shell.
 *
 * Every lens is driven from `AppState` rather than keeping view state to
 * itself, because a lens whose state lives inside it is a lens whose state
 * cannot be shared (docs/NUMERICS.md §14).
 */
export function App() {
  const [state, setState] = useState<AppState>(INITIAL.state);
  const active = LENSES.find((entry) => entry.id === state.lens) ?? LENSES[0];
  const selected =
    state.selectedObjectId === undefined ? undefined : CATALOG.get(state.selectedObjectId);

  const setLens = (lens: LensId): void => setState((current) => ({ ...current, lens }));

  /**
   * Selecting an object also makes it subject A in the comparator. Clearing the
   * selection does not un-choose it — that would throw away a comparison the
   * user may have set up deliberately.
   */
  const setSelected = (selectedObjectId: string | undefined): void =>
    setState((current) =>
      selectedObjectId === undefined
        ? { ...current, selectedObjectId }
        : {
            ...current,
            selectedObjectId,
            comparator: { ...current.comparator, a: { kind: 'object', id: selectedObjectId } },
          },
    );
  // Updater form, and stable: a lens can then attach a non-passive listener
  // once instead of on every camera change, and no lens needs a ref to reach
  // the current state from inside an event handler.
  const setAtlas = useCallback(
    (update: (current: AtlasState) => AtlasState) =>
      setState((current) => ({ ...current, atlas: update(current.atlas) })),
    [],
  );
  const setRuler = useCallback(
    (update: (current: RulerState) => RulerState) =>
      setState((current) => ({ ...current, ruler: update(current.ruler) })),
    [],
  );
  const setComparator = useCallback(
    (update: (current: ComparatorState) => ComparatorState) =>
      setState((current) => ({ ...current, comparator: update(current.comparator) })),
    [],
  );
  const setLab = useCallback(
    (update: (current: LabState) => LabState) =>
      setState((current) => ({ ...current, lab: update(current.lab) })),
    [],
  );
  const setMicroscope = useCallback(
    (update: (current: MicroscopeState) => MicroscopeState) =>
      setState((current) => ({ ...current, microscope: update(current.microscope) })),
    [],
  );
  const setRepresentations = useCallback(
    (update: (current: RepresentationState) => RepresentationState) =>
      setState((current) => ({ ...current, representations: update(current.representations) })),
    [],
  );

  /**
   * Hand an object to the Ruler, framed. The ruler's camera is app state now,
   * so the hand-off has to say where to point it rather than relying on the
   * lens remounting into a fresh default.
   */
  const openInRuler = (id: string): void =>
    setState((current) => {
      const framed = rulerPresets(id)[0]!;
      return {
        ...current,
        selectedObjectId: id,
        lens: 'ruler',
        comparator: { ...current.comparator, a: { kind: 'object', id } },
        ruler: { presetId: framed.id, camera: framed.camera },
      };
    });

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
              aria-current={entry.id === state.lens ? 'page' : undefined}
            >
              {entry.title}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <h2 className="app-title">{active?.title}</h2>
        <p className="lens-question">{active?.question}</p>

        <ShareBar state={state} restoreError={INITIAL.error} />

        {selected !== undefined && (
          <p className="selection-banner">
            Selected: <strong>{selected.name}</strong>
            <button type="button" onClick={() => setSelected(undefined)}>
              clear
            </button>
          </p>
        )}

        {state.lens === 'atlas' ? (
          <AtlasView
            state={state.atlas}
            onChange={setAtlas}
            selectedId={state.selectedObjectId}
            onSelect={setSelected}
            onOpenInRuler={openInRuler}
          />
        ) : state.lens === 'ruler' ? (
          <RulerView
            state={state.ruler}
            onChange={setRuler}
            focusObjectId={state.selectedObjectId}
          />
        ) : state.lens === 'comparator' ? (
          <ComparatorView state={state.comparator} onChange={setComparator} />
        ) : state.lens === 'microscope' ? (
          <MicroscopeView
            state={state.microscope}
            onChange={setMicroscope}
            representations={state.representations}
            onRepresentationsChange={setRepresentations}
          />
        ) : state.lens === 'lab' ? (
          <LabView
            state={state.lab}
            onChange={setLab}
            representations={state.representations}
            onRepresentationsChange={setRepresentations}
          />
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
