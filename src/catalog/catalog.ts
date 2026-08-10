/**
 * The object catalog.
 *
 * docs/DATA_MODEL.md: a graph, not a single hierarchy. The scale ordering below
 * is one projection of it — the one the Atlas will use — and category and
 * relation lookups are others.
 */

import rawObjects from '../../fixtures/objects.json';
import { compare as compareQuantities } from '../core/quantities/quantity';
import {
  type CatalogQuantity,
  type ScaleObject,
  CatalogError,
  parseScaleObject,
  primaryLength,
} from './schema';

export interface Catalog {
  readonly objects: readonly ScaleObject[];
  get(id: string): ScaleObject | undefined;
  require(id: string): ScaleObject;
  /** Objects with a length, smallest first. */
  byScale(): readonly ScaleObject[];
  search(query: string): readonly ScaleObject[];
  inCategory(category: string): readonly ScaleObject[];
  categories(): readonly string[];
}

export function createCatalog(entries: readonly unknown[]): Catalog {
  const objects = entries.map(parseScaleObject);

  const byId = new Map<string, ScaleObject>();
  for (const object of objects) {
    if (byId.has(object.id)) {
      throw new CatalogError(`Duplicate catalog id ${object.id}`);
    }
    byId.set(object.id, object);
  }

  // Relations are part of the graph, so a dangling target is a data error.
  //
  // So is authoring both directions of one relationship. `edgesOf` derives the
  // inverse of every authored edge, so a fixture that also writes the reverse
  // by hand produces two edges for one fact — the panel then lists the same
  // neighbour twice, and if the two directions were given different types it
  // lists it twice under different words. The rule is therefore one authored
  // relation per unordered pair, which is stronger than "not the same type
  // twice" and is what makes the derived inverse unambiguous.
  // Which length an object *is* has to be a decision someone made. With one
  // there is nothing to choose; with two, `primaryLength` used to return
  // whichever key `Object.values` came to first, and three lenses present that
  // number as the size of the thing.
  for (const object of objects) {
    const lengths = Object.values(object.quantities).filter(
      (quantity) => quantity.dimension === 'length',
    );
    const declared = lengths.filter((quantity) => quantity.primary === true);
    if (lengths.length > 1 && declared.length !== 1) {
      throw new CatalogError(
        `${object.id}: ${lengths.length} lengths (${lengths.map((one) => one.key).join(', ')}) ` +
          `and ${declared.length} marked primary — mark exactly one, since the atlas positions ` +
          `this object by it`,
      );
    }
  }

  const pairs = new Map<string, string>();
  for (const object of objects) {
    for (const relation of object.relations) {
      if (!byId.has(relation.targetId)) {
        throw new CatalogError(
          `${object.id}: relation points at unknown object ${relation.targetId}`,
        );
      }
      if (relation.targetId === object.id) {
        throw new CatalogError(`${object.id}: relation points at itself`);
      }
      const key = [object.id, relation.targetId].sort().join(' ');
      const existing = pairs.get(key);
      if (existing !== undefined) {
        throw new CatalogError(
          `${object.id}: ${relation.type} to ${relation.targetId} duplicates ${existing} — ` +
            `author one direction only; the other is derived`,
        );
      }
      pairs.set(key, `${object.id} ${relation.type} ${relation.targetId}`);
    }
  }

  const scaleOrdered = objects
    .filter((object) => primaryLength(object) !== undefined)
    .slice()
    .sort((a, b) => compareQuantities(primaryLength(a)!.value, primaryLength(b)!.value));

  return {
    objects: Object.freeze(objects),
    get: (id) => byId.get(id),
    require(id) {
      const object = byId.get(id);
      if (object === undefined) throw new CatalogError(`No catalog object with id ${id}`);
      return object;
    },
    byScale: () => Object.freeze(scaleOrdered),
    search(query) {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return Object.freeze(scaleOrdered);
      return Object.freeze(
        objects.filter(
          (object) =>
            object.id.toLowerCase().includes(needle) ||
            object.name.toLowerCase().includes(needle) ||
            object.aliases.some((alias) => alias.toLowerCase().includes(needle)) ||
            object.categories.some((category) => category.toLowerCase().includes(needle)),
        ),
      );
    },
    inCategory: (category) =>
      Object.freeze(objects.filter((object) => object.categories.includes(category))),
    categories: () =>
      Object.freeze([...new Set(objects.flatMap((object) => object.categories))].sort()),
  };
}

/** The built-in catalog, loaded from `fixtures/objects.json`. */
export const CATALOG: Catalog = createCatalog(rawObjects as unknown[]);

/** Convenience for the comparator: an object's length, or a clear failure. */
export function requireLength(object: ScaleObject): CatalogQuantity {
  const length = primaryLength(object);
  if (length === undefined) {
    throw new CatalogError(`${object.id} has no length to compare`);
  }
  return length;
}
