import { describe, expect, it } from 'vitest';
import { atlasEntries, clusterLabel, clusterNearest, clusteredCount, declutter } from './atlas';
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
