/**
 * The object graph.
 *
 * docs/DATA_MODEL.md §15: a graph, not a single hierarchy. The scale ordering
 * the Atlas draws is one projection of it; relations are another, and an object
 * belongs to as many as it belongs to.
 *
 * docs/UI_SPEC.md "Progressive semantic detail": zooming is both metric
 * navigation and ontology navigation. What that needs from this module is the
 * ability to ask "what is related to this, and which of those can I see from
 * where I am standing?"
 *
 * Deliberately not a graph database. Twenty-eight objects and a breadth-first
 * search; docs/IMPLEMENTATION_PLAN.md is explicit about not building one until
 * the fixture data requires it.
 */

import { type Rational } from '../core/rational/rational';
import { log10RationalForDisplay } from '../core/rational/log10';
import { type Catalog } from './catalog';
import { requireLength } from './catalog';
import { type ScaleObject } from './schema';

/**
 * Relation labels. `type` stays an open string in the schema, so an unknown
 * relation still traverses — it just reads back verbatim.
 */
const FORWARD_LABELS: Readonly<Record<string, string>> = {
  'part-of': 'part of',
  contains: 'contains',
  'contained-by': 'contained by',
  'made-of': 'made of',
  orbits: 'orbits',
  within: 'within',
};

const INVERSE_LABELS: Readonly<Record<string, string>> = {
  'part-of': 'has part',
  contains: 'contained by',
  'contained-by': 'contains',
  'made-of': 'component of',
  orbits: 'orbited by',
  within: 'encloses',
};

export interface GraphEdge {
  readonly type: string;
  readonly target: ScaleObject;
  /** True when this edge was derived by reversing an authored one. */
  readonly inverse: boolean;
  /** Human-readable direction, e.g. `part of` or `has part`. */
  readonly label: string;
}

/**
 * Every relation an object participates in, authored or derived.
 *
 * Only one direction is ever written in the fixture. Authoring both invites
 * them to disagree.
 */
export function edgesOf(catalog: Catalog, id: string): GraphEdge[] {
  const object = catalog.get(id);
  if (object === undefined) return [];

  const edges: GraphEdge[] = object.relations.map((relation) => ({
    type: relation.type,
    target: catalog.require(relation.targetId),
    inverse: false,
    label: FORWARD_LABELS[relation.type] ?? relation.type,
  }));

  for (const other of catalog.objects) {
    for (const relation of other.relations) {
      if (relation.targetId !== id) continue;
      edges.push({
        type: relation.type,
        target: other,
        inverse: true,
        label: INVERSE_LABELS[relation.type] ?? `${relation.type} (inverse)`,
      });
    }
  }
  return edges;
}

export function neighbourIds(catalog: Catalog, id: string): string[] {
  return edgesOf(catalog, id).map((edge) => edge.target.id);
}

/**
 * The relations *within* a set of objects, ignoring everything outside it.
 *
 * The Ruler draws whatever is legible at the current scale, which is a set
 * chosen by size alone. Some of what lands there is genuinely connected and
 * some is a coincidence of magnitude, and a picture of a finger, a hand, a
 * coconut, a human and a door invites the reader to assume the first reading
 * for all five. This is what lets a view say which is which.
 *
 * Edges to objects outside the set are dropped rather than reported as
 * out-of-view: a door being part of a house is true, but it is not a fact about
 * the picture.
 */
export function relationsAmong(catalog: Catalog, ids: readonly string[]): Map<string, GraphEdge[]> {
  const present = new Set(ids);
  return new Map(
    ids.map((id) => [id, edgesOf(catalog, id).filter((edge) => present.has(edge.target.id))]),
  );
}

export interface PathStep {
  readonly object: ScaleObject;
  /** How this object was reached from the previous one. Absent on the first. */
  readonly via?: GraphEdge | undefined;
}

/**
 * Shortest relation path between two objects, or `undefined` when the graph
 * does not connect them.
 *
 * This is what makes `human → hand → finger → skin cell → DNA` a navigable
 * chain rather than a hard-coded list (PROJECT_SPEC §14).
 */
export function relationPath(
  catalog: Catalog,
  fromId: string,
  toId: string,
): PathStep[] | undefined {
  if (catalog.get(fromId) === undefined || catalog.get(toId) === undefined) return undefined;
  if (fromId === toId) return [{ object: catalog.require(fromId) }];

  const cameFrom = new Map<string, { from: string; via: GraphEdge }>();
  const queue: string[] = [fromId];
  const seen = new Set<string>([fromId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edgesOf(catalog, current)) {
      if (seen.has(edge.target.id)) continue;
      seen.add(edge.target.id);
      cameFrom.set(edge.target.id, { from: current, via: edge });
      if (edge.target.id === toId) {
        const path: PathStep[] = [{ object: edge.target, via: edge }];
        let walker = current;
        while (walker !== fromId) {
          const previous = cameFrom.get(walker)!;
          path.unshift({ object: catalog.require(walker), via: previous.via });
          walker = previous.from;
        }
        path.unshift({ object: catalog.require(fromId) });
        return path;
      }
      queue.push(edge.target.id);
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Scale-sensitive suggestions                                                 */
/* -------------------------------------------------------------------------- */

export interface ScaleBand {
  /** log10 of the smallest magnitude currently legible. */
  readonly minLog10: number;
  /** log10 of the largest. */
  readonly maxLog10: number;
}

export type Visibility = 'below-band' | 'in-band' | 'above-band';

export interface Suggestion {
  readonly object: ScaleObject;
  /** How it relates to the object asked about, when it does. */
  readonly edge?: GraphEdge | undefined;
  readonly log10: number;
  readonly visibility: Visibility;
  /** How many decades of zoom away it is; 0 when already in band. */
  readonly decadesAway: number;
}

export function log10Of(object: ScaleObject): number {
  return log10RationalForDisplay(requireLength(object).value.value);
}

export function visibilityIn(band: ScaleBand, log10: number): Visibility {
  if (log10 < band.minLog10) return 'below-band';
  if (log10 > band.maxLog10) return 'above-band';
  return 'in-band';
}

function decadesFrom(band: ScaleBand, log10: number): number {
  if (log10 < band.minLog10) return band.minLog10 - log10;
  if (log10 > band.maxLog10) return log10 - band.maxLog10;
  return 0;
}

/**
 * What the graph has to offer from where the camera is standing.
 *
 * Objects already in view come first; the rest are kept and labelled with how
 * far away they are, because "zoom in and there is more" is the whole idea of
 * progressive detail. Nothing is hidden — it is ordered.
 */
export function suggestFrom(catalog: Catalog, id: string, band: ScaleBand): Suggestion[] {
  return edgesOf(catalog, id)
    .map((edge) => {
      const log10 = log10Of(edge.target);
      return {
        object: edge.target,
        edge,
        log10,
        visibility: visibilityIn(band, log10),
        decadesAway: decadesFrom(band, log10),
      };
    })
    .sort((a, b) => a.decadesAway - b.decadesAway || a.log10 - b.log10);
}

/**
 * Objects revealed purely by scale — the "what else lives at this size"
 * question the Atlas answers as you zoom.
 *
 * `exclude` is a set rather than the selected id alone because the caller
 * showing this beside a list of relations must exclude *those* too. An object
 * named as a relation and then named again under "unrelated" is a duplicate and
 * a false statement in one row.
 */
export function revealedIn(
  catalog: Catalog,
  band: ScaleBand,
  exclude: Iterable<string> = [],
): Suggestion[] {
  const excluded = new Set(exclude);
  return catalog
    .byScale()
    .filter((object) => !excluded.has(object.id))
    .map((object) => ({ object, log10: log10Of(object) }))
    .filter(({ log10 }) => visibilityIn(band, log10) === 'in-band')
    .map(({ object, log10 }) => ({
      object,
      log10,
      visibility: 'in-band' as const,
      decadesAway: 0,
    }));
}

/**
 * The band an object is comfortably legible in.
 *
 * `semanticDetail` overrides it where a fixture author has an opinion;
 * otherwise it is a couple of decades either side of the object's own size,
 * which is where a thing is neither a dot nor larger than the view.
 *
 * Both halves are sizes in metres. They were not: the field declared a camera
 * resolution and this function read it as a size, so a fixture that used it
 * would have been wrong by a factor of the viewport width. Nothing caught it
 * because no fixture uses it — see `semanticDetail` in `schema.ts`.
 */
export function bandFor(object: ScaleObject, spread = 2): ScaleBand {
  const centre = log10Of(object);
  const declared = object.semanticDetail;
  return {
    minLog10:
      declared?.minMeters === undefined
        ? centre - spread
        : log10RationalForDisplay(declared.minMeters),
    maxLog10:
      declared?.maxMeters === undefined
        ? centre + spread
        : log10RationalForDisplay(declared.maxMeters),
  };
}

/** A band from an exact visible extent, for callers holding a camera. */
export function bandFromExtent(minMeters: Rational, maxMeters: Rational): ScaleBand {
  return {
    minLog10: log10RationalForDisplay(minMeters),
    maxLog10: log10RationalForDisplay(maxMeters),
  };
}
