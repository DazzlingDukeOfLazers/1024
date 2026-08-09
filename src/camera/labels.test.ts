import { describe, expect, it } from 'vitest';
import { type LabelBox, estimateTextWidth, keepNonOverlapping, placeInRows } from './labels';

const box = (x: number, text: string, anchor: LabelBox['anchor'] = 'start'): LabelBox => ({
  x,
  width: estimateTextWidth(text, 11),
  anchor,
});

describe('estimateTextWidth', () => {
  it('grows with the text and with the font', () => {
    expect(estimateTextWidth('mm', 11)).toBeLessThan(estimateTextWidth('millimetre', 11));
    expect(estimateTextWidth('mm', 11)).toBeLessThan(estimateTextWidth('mm', 22));
  });

  it('errs wide, because dropping a label beats overlapping one', () => {
    // A real SVG measurement of "Virus (representative)" at 11px is about 133px.
    // The estimate must not come in under that.
    expect(estimateTextWidth('Virus (representative)', 11)).toBeGreaterThan(133);
  });
});

describe('placeInRows', () => {
  it('puts labels that do not collide on the first row', () => {
    const items = [box(0, 'Ant'), box(300, 'Sun'), box(600, 'Moon')];
    expect(placeInRows(items, (b) => b, 3).map((placed) => placed.row)).toEqual([0, 0, 0]);
  });

  it('pushes a colliding label to the next row', () => {
    // This is the case that was broken on screen: a long name followed closely
    // by a short one, where a fixed allowance said they fitted and they did not.
    const items = [box(0, 'Virus (representative)'), box(100, 'Human')];
    expect(placeInRows(items, (b) => b, 3).map((placed) => placed.row)).toEqual([0, 1]);
  });

  it('uses the label that is actually there, not a fixed allowance', () => {
    const short = placeInRows([box(0, 'Ant'), box(60, 'Sun')], (b) => b, 3);
    const long = placeInRows([box(0, 'Observable universe'), box(60, 'Sun')], (b) => b, 3);
    expect(short.map((p) => p.row)).toEqual([0, 0]);
    expect(long.map((p) => p.row)).toEqual([0, 1]);
  });

  it('gives up rather than overlapping when every row is taken', () => {
    const items = [box(0, 'Aaaaaaaaaa'), box(4, 'Bbbbbbbbbb'), box(8, 'Cccccccccc'), box(12, 'D')];
    const rows = placeInRows(items, (b) => b, 3).map((placed) => placed.row);
    expect(rows).toEqual([0, 1, 2, -1]);
  });

  it('drops a label that would run off the edge rather than cutting it in half', () => {
    const items = [box(0, 'Ant'), box(390, 'City (Chicago-scale extent)')];
    const rows = placeInRows(items, (b) => b, 3, { bounds: { min: 0, max: 420 } });
    expect(rows.map((placed) => placed.row)).toEqual([0, -1]);
  });

  it('accounts for the anchor, so a centred label reserves both sides', () => {
    const items = [box(100, 'Sun', 'middle'), box(120, 'Moon', 'middle')];
    expect(placeInRows(items, (b) => b, 2).map((placed) => placed.row)).toEqual([0, 1]);
  });
});

describe('keepNonOverlapping', () => {
  it('keeps everything when nothing collides', () => {
    const items = [box(0, 'µm'), box(200, 'mm'), box(400, 'm')];
    expect(keepNonOverlapping(items, (b) => b)).toHaveLength(3);
  });

  it('drops the later of two that collide', () => {
    const items = [box(0, '10^-45 m'), box(20, '10^-42 m'), box(400, '10^-39 m')];
    const kept = keepNonOverlapping(items, (b) => b);
    expect(kept.map((b) => b.x)).toEqual([0, 400]);
  });

  it('drops a label that would run into something already on the line', () => {
    // The Ruler's unit symbol sits in the top right corner; the last tick label
    // was drawn straight through it.
    const unit = box(400, 'µm', 'end');
    const items = [box(0, '-200'), box(390, '200')];
    const kept = keepNonOverlapping(items, (b) => b, { reserved: [unit] });
    expect(kept.map((b) => b.x)).toEqual([0]);
  });

  it('is order-preserving and never returns something it was not given', () => {
    const items = [box(0, 'a'), box(9, 'b'), box(300, 'c')];
    const kept = keepNonOverlapping(items, (b) => b);
    for (const item of kept) expect(items).toContain(item);
    expect(kept.map((b) => b.x)).toEqual([...kept.map((b) => b.x)].sort((a, b) => a - b));
  });
});
