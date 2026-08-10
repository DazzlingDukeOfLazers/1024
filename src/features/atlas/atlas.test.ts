import { pow10 } from '../../core/rational/rational';
import { describe, expect, it } from 'vitest';
import {
  type AtlasEntry,
  ATLAS_ENTRIES,
  atlasEntries,
  clusterLabel,
  clusterNearest,
  clusteredCount,
  declutter,
} from './atlas';
import { type Viewport } from '../../camera/camera';
import { createLogCamera, frameDecades } from '../../camera/logCamera';
import { estimateTextWidth } from '../../camera/labels';
import { CATALOG } from '../../catalog/catalog';

const viewport: Viewport = { widthPx: 1000, heightPx: 300 };
const entries = atlasEntries(CATALOG.byScale());

describe('placing the catalog', () => {
  it('places every object with a positive length', () => {
    expect(entries.length).toBe(CATALOG.byScale().length);
  });

  it('orders by magnitude, smallest first', () => {
    expect(entries[0]?.object.id).toBe('planck-length');
    expect(entries.at(-1)?.object.id).toBe('observable-universe');
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i]!.log10).toBeGreaterThanOrEqual(entries[i - 1]!.log10);
    }
  });

  it('spans about 62 decades', () => {
    const span = entries.at(-1)!.log10 - entries[0]!.log10;
    expect(span).toBeGreaterThan(60);
    expect(span).toBeLessThan(65);
  });

  it('computes each position once, independent of the camera', () => {
    // log10 is a property of the object; only x depends on the camera.
    const again = atlasEntries(CATALOG.byScale());
    expect(again.map((entry) => entry.log10)).toEqual(entries.map((entry) => entry.log10));
  });
});

describe('decluttering', () => {
  it('shows every object separately when there is room', () => {
    const camera = createLogCamera(-4, 400);
    // Zoomed right in, only a few objects are in view but none are merged.
    const clusters = declutter(entries, camera, viewport);
    expect(clusters.every((cluster) => cluster.members.length === 1)).toBe(true);
  });

  it('merges markers that would overlap, and drops nothing', () => {
    // The whole catalog across one viewport: markers must collide.
    const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
    const clusters = declutter(entries, camera, viewport);

    expect(clusters.length).toBeLessThan(entries.length);
    // Every object is still accounted for inside some cluster.
    expect(clusteredCount(clusters)).toBe(entries.length);

    const ids = clusters.flatMap((cluster) => cluster.members.map((m) => m.object.id));
    expect(new Set(ids).size).toBe(entries.length);
  });

  it('keeps merged markers at least the minimum spacing apart', () => {
    const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
    const clusters = declutter(entries, camera, viewport, { minMarkerSpacingPx: 20 });
    for (let i = 1; i < clusters.length; i += 1) {
      expect(clusters[i]!.x - clusters[i - 1]!.x).toBeGreaterThanOrEqual(20);
    }
  });

  it('names a cluster after its representative and counts the rest', () => {
    const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
    const clusters = declutter(entries, camera, viewport);
    const merged = clusters.find((cluster) => cluster.members.length > 1);

    expect(merged).toBeDefined();
    expect(clusterLabel(merged!)).toContain('+');
    expect(clusterLabel(merged!)).toContain(merged!.representative.object.name);

    const single = clusters.find((cluster) => cluster.members.length === 1);
    expect(clusterLabel(single!)).toBe(single!.representative.object.name);
  });

  it('culls what is off screen instead of drawing it', () => {
    const camera = createLogCamera(-30, 60);
    const clusters = declutter(entries, camera, viewport);
    expect(clusters.length).toBeLessThan(entries.length);
    for (const cluster of clusters) {
      expect(cluster.x).toBeGreaterThan(-200);
      expect(cluster.x).toBeLessThan(viewport.widthPx + 200);
    }
  });
});

describe('label staggering', () => {
  it('spreads crowded labels across rows rather than overlapping them', () => {
    const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
    const clusters = declutter(entries, camera, viewport, { labelRows: 3 });

    const rows = new Set(clusters.map((cluster) => cluster.labelRow));
    expect(rows.size).toBeGreaterThan(1);

    // Within a row, no label runs into the one before it. The test used to
    // assert a fixed 96 px gap, which is what the code assumed and what let
    // "Virus (representative)" overlap "Human" on screen: the allowance was met
    // and the words still collided. What matters is the width of the text that
    // is actually drawn.
    for (let row = 0; row < 3; row += 1) {
      const inRow = clusters.filter((cluster) => cluster.labelRow === row);
      for (let i = 1; i < inRow.length; i += 1) {
        const previous = inRow[i - 1]!;
        const gap = inRow[i]!.x - previous.x;
        expect(gap, `row ${row}, after ${clusterLabel(previous)}`).toBeGreaterThanOrEqual(
          estimateTextWidth(clusterLabel(previous), 11),
        );
      }
    }
  });

  it('marks a cluster as unlabelled rather than overlapping when rows run out', () => {
    const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
    const clusters = declutter(entries, camera, viewport, { labelRows: 1 });
    expect(clusters.some((cluster) => cluster.labelRow === -1)).toBe(true);
    // Unlabelled is not the same as dropped — the marker and its members remain.
    expect(clusteredCount(clusters)).toBe(entries.length);
  });

  it('labels everything when there is plenty of room', () => {
    const camera = createLogCamera(0, 400);
    const clusters = declutter(entries, camera, viewport);
    expect(clusters.every((cluster) => cluster.labelRow >= 0)).toBe(true);
  });
});

describe('hit testing', () => {
  const camera = frameDecades(entries[0]!.log10, entries.at(-1)!.log10, viewport);
  const clusters = declutter(entries, camera, viewport);

  it('finds the cluster nearest a click', () => {
    const target = clusters[3]!;
    expect(clusterNearest(clusters, target.x)).toBe(target);
    expect(clusterNearest(clusters, target.x + 2)).toBe(target);
  });

  it('returns nothing when the click is nowhere near', () => {
    expect(clusterNearest(clusters, -500)).toBeUndefined();
    expect(clusterNearest(clusters, clusters[0]!.x, 0)).toBeDefined();
  });
});

describe('navigating from microscopic to astronomical', () => {
  it('brings each band of the catalog into view in turn', () => {
    // The acceptance criterion: the atlas has to work across the whole range,
    // not just in the middle of it.
    const bands: [string, number][] = [
      ['proton', -15],
      ['red-blood-cell', -5],
      ['human', 0],
      ['earth', 7],
      ['light-year', 16],
      ['observable-universe', 27],
    ];

    for (const [id, centre] of bands) {
      const camera = createLogCamera(centre, 60);
      const clusters = declutter(entries, camera, viewport);
      const found = clusters.some((cluster) =>
        cluster.members.some((member) => member.object.id === id),
      );
      expect(found, `${id} not visible at 10^${centre}`).toBe(true);
    }
  });
});

describe('panning does not regroup the objects', () => {
  // A cluster is anchored at its first *visible* member, so culling can in
  // principle re-anchor one: if the anchor falls outside the cull margin while
  // a member a few pixels away does not, the merge boundary moves and the next
  // object may join a different cluster. A marker that names a different object
  // depending on where you have panned is a label making a claim it cannot
  // keep.
  //
  // Measured on the real catalog first: it never happens. Across 400 pan steps
  // at five zoom levels, no object changed which set it was grouped with — and
  // narrowing the cull margin from 120 px to 12 did not change that either.
  // Twenty-eight objects are simply too sparse to put three of them inside the
  // window where an anchor is culled and its members are not. That is what
  // TASKS meant by "fine at 28 objects".
  //
  // So the real catalog cannot exercise this, and a test that cannot fail is
  // not a test. These entries are synthetic and deliberately crowded: a dozen
  // objects a few pixels apart, dragged across the cull boundary. That is the
  // shape a 500-object catalog would have, and it is where the property has to
  // hold.
  const crowded = (count: number, decadesApart: number): AtlasEntry[] =>
    Array.from({ length: count }, (_, index) => {
      const log10 = index * decadesApart;
      return {
        object: {
          id: `crowd-${index}`,
          name: `Crowd ${index}`,
          categories: ['test'],
          quantities: {},
        } as unknown as AtlasEntry['object'],
        meters: pow10(Math.round(log10)),
        log10,
      };
    });

  const groupingsAcross = (entries: readonly AtlasEntry[], pixelsPerDecade: number) => {
    const viewport = { widthPx: 600, heightPx: 200 };
    const groupOf = new Map<string, string>();
    const conflicts: string[] = [];
    let grouped = 0;

    for (let step = 0; step < 300; step += 1) {
      const camera = { centerLog10: step * 0.02, pixelsPerDecade };
      for (const cluster of declutter(entries, camera, viewport)) {
        if (cluster.members.length < 2) continue;
        const group = cluster.members.map((member) => member.object.id).join('+');
        for (const member of cluster.members) {
          const before = groupOf.get(member.object.id);
          if (before === undefined) {
            groupOf.set(member.object.id, group);
            grouped += 1;
          } else if (before !== group) {
            conflicts.push(`${member.object.id}: "${before}" then "${group}"`);
          }
        }
      }
    }
    return { conflicts, grouped };
  };

  it('holds on a crowded axis, where it can actually be tested', () => {
    // A dozen objects at a twentieth of a decade apart: at 100 px per decade
    // that is 5 px, half the merge distance, so they cluster in overlapping
    // runs and every pan step moves the cull boundary through one of them.
    const { conflicts, grouped } = groupingsAcross(crowded(12, 0.05), 100);
    expect(conflicts, conflicts.slice(0, 3).join(' | ')).toEqual([]);
    // Anti-vacuity: the entries have to actually cluster, or the loop compared
    // nothing. This is what the real catalog could not provide.
    expect(grouped, 'objects observed sharing a marker').toBeGreaterThan(5);
  });

  it('never lets a cluster grow wider than the distance it merges at', () => {
    // Anchor-clustering, not chaining, and a mutant that swapped them survived
    // the invariant above — both are pan-invariant, so that test cannot tell
    // them apart. The difference is real: comparing each entry against the
    // previous *member* rather than the anchor lets a long run of near-misses
    // chain into one enormous cluster whose ends are nowhere near each other,
    // and the marker would then stand for objects decades apart.
    const pixelsPerDecade = 100;
    const spacingInDecades = 10 / pixelsPerDecade;
    // Spaced at six tenths of the merge distance: every neighbour merges, so
    // chaining would swallow all twelve into one.
    const entries = crowded(12, spacingInDecades * 0.6);
    const clusters = declutter(
      entries,
      { centerLog10: 0.3, pixelsPerDecade },
      {
        widthPx: 600,
        heightPx: 200,
      },
    );

    for (const cluster of clusters) {
      const spread = cluster.members[cluster.members.length - 1]!.log10 - cluster.members[0]!.log10;
      expect(spread, `${cluster.members.length} members spanning ${spread}`).toBeLessThan(
        spacingInDecades,
      );
    }
    // Anti-vacuity: they must actually have merged, or the bound is trivial.
    expect(clusters.some((cluster) => cluster.members.length > 1)).toBe(true);
    expect(clusters.length, 'chaining would have collapsed these to one').toBeGreaterThan(1);
  });

  it('holds on the real catalog too', () => {
    const { conflicts, grouped } = groupingsAcross(ATLAS_ENTRIES, 45);
    expect(conflicts, conflicts.slice(0, 3).join(' | ')).toEqual([]);
    expect(grouped, 'objects observed sharing a marker').toBeGreaterThan(3);
  });
});
