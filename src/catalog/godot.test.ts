import { describe, expect, it } from 'vitest';
import fixtures from '../../fixtures/objects.json';
import godotCopy from '../../godot/data/objects.json';
import godotExtras from '../../godot/data/objects.godot.json';
import { createCatalog } from './catalog';

// The Godot viewer (godot/) is a second consumer of the catalog, as
// PROJECT_SPEC §22 asks: it shares the data model, not the renderer. Godot can
// only read files inside its own project folder, so it carries a copy of
// fixtures/objects.json plus its own extras file. These tests keep the copy
// honest and hold the extras to the same schema rules as the web catalog.
describe('the Godot catalog', () => {
  it('carries an unmodified copy of fixtures/objects.json', () => {
    expect(godotCopy).toEqual(fixtures);
  });

  it('extras pass the same schema rules as the built-in catalog, with no id collisions', () => {
    const catalog = createCatalog([...fixtures, ...godotExtras]);
    expect(catalog.objects.length).toBe(fixtures.length + godotExtras.length);
  });

  it('gives every extra exactly one quantity, so the viewer never has to choose', () => {
    for (const entry of godotExtras) {
      expect(Object.keys(entry.quantities), entry.id).toHaveLength(1);
    }
  });
});
