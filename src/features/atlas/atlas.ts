/**
 * Atlas object placement and decluttering.
 *
 * docs/UI_SPEC.md §1: "Object markers should cluster/declutter when too dense."
 *
 * Two separate problems, handled separately:
 *
 * - **Markers** collide when objects sit within a few pixels of each other.
 *   Those merge into a cluster, and the cluster reports everything inside it.
 *   Nothing is silently dropped.
 * - **Labels** collide much sooner than markers do, because text is wide. Those
 *   are staggered across rows, and only dropped when even staggering fails.
 */

import { type Rational } from '../../core/rational/rational';
import { log10RationalForDisplay } from '../../core/rational/log10';
import { type Viewport } from '../../camera/camera';
import { type LogCamera, atlasXFromLog10, frameDecades } from '../../camera/logCamera';
import { estimateTextWidth, placeInRows } from '../../camera/labels';
import { type ScaleObject } from '../../catalog/schema';
import { CATALOG, requireLength } from '../../catalog/catalog';

const CATALOG_OBJECTS = () => CATALOG.byScale();

export const ATLAS_VIEWPORT: Viewport = { widthPx: 960, heightPx: 240 };

export interface AtlasEntry {
  readonly object: ScaleObject;
  readonly meters: Rational;
  readonly log10: number;
}

/**
 * Resolve each object's axis position once. The log10 is a property of the
 * object, not of the camera, so it survives panning and zooming unchanged.
 */
export function atlasEntries(objects: readonly ScaleObject[]): AtlasEntry[] {
  return objects
    .map((object) => ({ object, meters: requireLength(object).value.value }))
    .filter(({ meters }) => meters.numerator > 0n)
    .map(({ object, meters }) => ({ object, meters, log10: log10RationalForDisplay(meters) }))
    .sort((a, b) => a.log10 - b.log10);
}

export interface AtlasCluster {
  readonly x: number;
  readonly log10: number;
  /** Every object in this cluster, smallest first. At least one. */
  readonly members: readonly AtlasEntry[];
  /** The member the cluster is named after. */
  readonly representative: AtlasEntry;
  /** Row to draw the label on, for staggering. -1 means no room for a label. */
  readonly labelRow: number;
}

export interface DeclutterOptions {
  /** Markers closer than this merge into one cluster. */
  readonly minMarkerSpacingPx?: number;
  /** How many rows labels may be staggered across. */
  readonly labelRows?: number;
  /** Pixels of slack outside the viewport before an entry is culled. */
  readonly cullMarginPx?: number;
  /** Font size the labels are drawn at, which is what sets how wide they are. */
  readonly labelFontSizePx?: number;
}

const DEFAULTS = {
  minMarkerSpacingPx: 10,
  labelRows: 3,
  cullMarginPx: 120,
  labelFontSizePx: 11,
} as const;

/**
 * Place entries, merge colliding markers, and assign label rows.
 *
 * Entries must already be sorted by log10; `atlasEntries` does that.
 */
export function declutter(
  entries: readonly AtlasEntry[],
  camera: LogCamera,
  viewport: Viewport,
  options: DeclutterOptions = {},
): AtlasCluster[] {
  const minMarkerSpacing = options.minMarkerSpacingPx ?? DEFAULTS.minMarkerSpacingPx;
  const labelRows = options.labelRows ?? DEFAULTS.labelRows;
  const cullMargin = options.cullMarginPx ?? DEFAULTS.cullMarginPx;
  const labelFontSize = options.labelFontSizePx ?? DEFAULTS.labelFontSizePx;

  // Merge markers that would overlap, over *every* entry rather than the
  // visible ones, and in log10 rather than in screen x.
  //
  // Both details are the same fix. Screen x is `pixelsPerDecade × log10` plus a
  // pan offset, so a difference of two x values does not depend on the pan —
  // but which entries survive culling does, and the cluster was anchored at the
  // first survivor. Pan until an anchor crosses the cull boundary while a
  // member five pixels away does not, and the anchor moves, the merge boundary
  // moves with it, and the next object joins a different cluster. A marker that
  // names a different object depending on where you have panned is a label
  // making a claim it cannot keep.
  //
  // Grouping now depends on the zoom and nothing else. Culling happens after,
  // to the finished clusters, where it cannot change what belongs to what.
  const spacingInDecades = minMarkerSpacing / camera.pixelsPerDecade;
  const clusters: { log10: number; members: AtlasEntry[] }[] = [];
  for (const entry of entries) {
    const current = clusters[clusters.length - 1];
    if (current !== undefined && entry.log10 - current.log10 < spacingInDecades) {
      current.members.push(entry);
      continue;
    }
    clusters.push({ log10: entry.log10, members: [entry] });
  }

  const visible = clusters
    .map((cluster) => ({ ...cluster, x: atlasXFromLog10(camera, cluster.log10, viewport) }))
    .filter(
      ({ x }) => Number.isFinite(x) && x >= -cullMargin && x <= viewport.widthPx + cullMargin,
    );

  // Stagger labels by how wide each one actually is. A fixed allowance was what
  // let "Virus (representative)" run straight through "Human": the allowance
  // said they fitted, and the words did not.
  const placed = placeInRows(
    visible.map((cluster) => ({
      ...cluster,
      representative: cluster.members[0]!,
    })),
    (cluster) => ({
      x: cluster.x,
      width: estimateTextWidth(
        labelTextFor(cluster.members[0]!, cluster.members.length),
        labelFontSize,
      ),
      anchor: 'start' as const,
    }),
    labelRows,
    // A name that starts near the right edge is cut in half rather than read.
    { bounds: { min: 0, max: viewport.widthPx } },
  );

  return placed.map(({ item, row }) => ({
    x: item.x,
    log10: item.log10,
    members: item.members,
    representative: item.representative,
    labelRow: row,
  }));
}

/** The text a cluster of `size` members anchored at `representative` will draw. */
function labelTextFor(representative: AtlasEntry, size: number): string {
  return size === 1 ? representative.object.name : `${representative.object.name} +${size - 1}`;
}

/** Text for a cluster: the representative's name, plus how many it stands for. */
export function clusterLabel(cluster: AtlasCluster): string {
  return labelTextFor(cluster.representative, cluster.members.length);
}

/** Total objects placed, however they were grouped. Nothing is ever dropped silently. */
export function clusteredCount(clusters: readonly AtlasCluster[]): number {
  return clusters.reduce((total, cluster) => total + cluster.members.length, 0);
}

/** The cluster nearest a screen x, for click-to-select. */
export function clusterNearest(
  clusters: readonly AtlasCluster[],
  x: number,
  maxDistancePx = 24,
): AtlasCluster | undefined {
  let best: AtlasCluster | undefined;
  let bestDistance = maxDistancePx;
  for (const cluster of clusters) {
    const distance = Math.abs(cluster.x - x);
    if (distance <= bestDistance) {
      best = cluster;
      bestDistance = distance;
    }
  }
  return best;
}

/** Every catalog object with a length, positioned once. */
export const ATLAS_ENTRIES: readonly AtlasEntry[] = atlasEntries(CATALOG_OBJECTS());

/** A camera framing the whole catalog, from the Planck length outwards. */
export function fullRangeCamera(viewport: Viewport = ATLAS_VIEWPORT): LogCamera {
  return frameDecades(ATLAS_ENTRIES[0]!.log10, ATLAS_ENTRIES.at(-1)!.log10, viewport);
}
