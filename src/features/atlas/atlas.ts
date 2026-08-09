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
  /** Labels closer than this on the same row are pushed to the next row. */
  readonly minLabelSpacingPx?: number;
  /** How many rows labels may be staggered across. */
  readonly labelRows?: number;
  /** Pixels of slack outside the viewport before an entry is culled. */
  readonly cullMarginPx?: number;
}

const DEFAULTS = {
  minMarkerSpacingPx: 10,
  minLabelSpacingPx: 96,
  labelRows: 3,
  cullMarginPx: 120,
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
  const minLabelSpacing = options.minLabelSpacingPx ?? DEFAULTS.minLabelSpacingPx;
  const labelRows = options.labelRows ?? DEFAULTS.labelRows;
  const cullMargin = options.cullMarginPx ?? DEFAULTS.cullMarginPx;

  const visible = entries
    .map((entry) => ({ entry, x: atlasXFromLog10(camera, entry.log10, viewport) }))
    .filter(
      ({ x }) => Number.isFinite(x) && x >= -cullMargin && x <= viewport.widthPx + cullMargin,
    );

  // Merge markers that would overlap. A cluster is anchored at its first
  // member, so panning does not make members jump between clusters.
  const clusters: { x: number; log10: number; members: AtlasEntry[] }[] = [];
  for (const { entry, x } of visible) {
    const current = clusters[clusters.length - 1];
    if (current !== undefined && x - current.x < minMarkerSpacing) {
      current.members.push(entry);
      continue;
    }
    clusters.push({ x, log10: entry.log10, members: [entry] });
  }

  // Stagger labels. Each row remembers where its last label ended, so a long
  // name on row 0 pushes the next one to row 1 rather than overlapping it.
  const rowEnds = new Array<number>(labelRows).fill(Number.NEGATIVE_INFINITY);
  return clusters.map((cluster) => {
    const representative = cluster.members[0]!;
    let labelRow = -1;
    for (let row = 0; row < labelRows; row += 1) {
      if (cluster.x - rowEnds[row]! >= minLabelSpacing) {
        rowEnds[row] = cluster.x;
        labelRow = row;
        break;
      }
    }
    return {
      x: cluster.x,
      log10: cluster.log10,
      members: cluster.members,
      representative,
      labelRow,
    };
  });
}

/** Text for a cluster: the representative's name, plus how many it stands for. */
export function clusterLabel(cluster: AtlasCluster): string {
  const extra = cluster.members.length - 1;
  return extra === 0
    ? cluster.representative.object.name
    : `${cluster.representative.object.name} +${extra}`;
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
