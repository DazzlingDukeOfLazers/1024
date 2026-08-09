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
  for (const object of objects) {
    for (const relation of object.relations) {
      if (!byId.has(relation.targetId)) {
        throw new CatalogError(
          `${object.id}: relation points at unknown object ${relation.targetId}`,
        );
      }
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
