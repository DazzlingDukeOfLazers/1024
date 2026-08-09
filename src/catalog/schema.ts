/**
 * Catalog schema and runtime validation.
 *
 * docs/DATA_MODEL.md. Two principles the types enforce rather than suggest:
 *
 * - **Identity is separate from visuals.** `red-blood-cell` is the same object
 *   whatever draws it, so `visuals` is optional and never part of the key.
 * - **Representative size is separate from exact conversion.** A millimetre is
 *   exactly defined; a red blood cell's diameter is a measurement with a range.
 *   Every quantity carries an `approximation` so the UI can never present the
 *   two with the same certainty.
 */

import { type Rational } from '../core/rational/rational';
import { type RationalJSON, fromJSON as rationalFromJSON } from '../core/rational/json';
import { parseRationalExact } from '../core/rational/parse';
import { type DimensionKind, isDimensionKind } from '../core/units/dimensions';
import { requireUnit } from '../core/units/units';
import { type Quantity, fromUnit } from '../core/quantities/quantity';

export const APPROXIMATION_KINDS = ['exact', 'measured', 'representative', 'estimated'] as const;
export type ApproximationKind = (typeof APPROXIMATION_KINDS)[number];

export const VISUAL_PROVIDERS = [
  'bundled',
  'noun-project',
  'openmoji',
  'wikimedia',
  'custom',
] as const;
export type VisualProvider = (typeof VISUAL_PROVIDERS)[number];

export interface VisualAsset {
  readonly provider: VisualProvider;
  readonly id?: string;
  readonly path?: string;
  readonly attribution?: string;
}

export interface QuantityRange {
  readonly min: Quantity;
  readonly max: Quantity;
}

export interface CatalogQuantity {
  /** Semantic name, e.g. `diameter`, `height`. */
  readonly key: string;
  readonly dimension: DimensionKind;
  /** Representative value, exact, in canonical SI units. */
  readonly value: Quantity;
  /** Natural variation or measurement spread, where the source has one. */
  readonly range?: QuantityRange;
  readonly approximation: ApproximationKind;
  /** Unit the fixture author wrote, kept for display. */
  readonly declaredUnit: string;
  readonly note?: string;
  readonly source?: string;
}

export interface ObjectRelation {
  readonly type: string;
  readonly targetId: string;
}

export interface ScaleObject {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly quantities: Readonly<Record<string, CatalogQuantity>>;
  readonly categories: readonly string[];
  readonly relations: readonly ObjectRelation[];
  readonly visuals: readonly VisualAsset[];
  readonly semanticDetail?: {
    readonly minMetersPerPixel?: Rational;
    readonly maxMetersPerPixel?: Rational;
  };
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/* -------------------------------------------------------------------------- */
/* Value parsing                                                               */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Accepts either the `{numerator, denominator}` form from docs/DATA_MODEL.md or
 * a plain string such as `"7.5"` or `"3/20"`.
 *
 * The string form is an addition: hand-authoring `7.5 µm` as a fraction of
 * metres is a transcription bug waiting to happen, and the value stays exactly
 * as exact either way.
 */
function parseValue(raw: unknown, context: string): Rational {
  if (typeof raw === 'string') {
    try {
      return parseRationalExact(raw);
    } catch (error) {
      throw new CatalogError(
        `${context}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (isRecord(raw) && typeof raw.numerator === 'string' && typeof raw.denominator === 'string') {
    return rationalFromJSON(raw as unknown as RationalJSON);
  }
  throw new CatalogError(`${context}: expected an exact value, got ${JSON.stringify(raw)}`);
}

function parseQuantity(key: string, raw: unknown, objectId: string): CatalogQuantity {
  const context = `${objectId}.${key}`;
  if (!isRecord(raw)) {
    throw new CatalogError(`${context}: expected an object`);
  }
  if (typeof raw.dimension !== 'string' || !isDimensionKind(raw.dimension)) {
    throw new CatalogError(`${context}: unknown dimension ${String(raw.dimension)}`);
  }
  if (typeof raw.unit !== 'string') {
    throw new CatalogError(`${context}: missing unit`);
  }
  const unit = requireUnit(raw.unit);
  if (unit.dimension !== raw.dimension) {
    throw new CatalogError(
      `${context}: unit ${unit.symbol} is a ${unit.dimension}, not a ${raw.dimension}`,
    );
  }
  if (
    typeof raw.approximation !== 'string' ||
    !(APPROXIMATION_KINDS as readonly string[]).includes(raw.approximation)
  ) {
    throw new CatalogError(
      `${context}: approximation must be one of ${APPROXIMATION_KINDS.join(', ')}`,
    );
  }

  const value = fromUnit(parseValue(raw.representative, `${context}.representative`), raw.unit);

  let range: QuantityRange | undefined;
  if (raw.range !== undefined) {
    if (!isRecord(raw.range)) throw new CatalogError(`${context}.range: expected an object`);
    const min = fromUnit(parseValue(raw.range.min, `${context}.range.min`), raw.unit);
    const max = fromUnit(parseValue(raw.range.max, `${context}.range.max`), raw.unit);
    if (min.value.numerator * max.value.denominator > max.value.numerator * min.value.denominator) {
      throw new CatalogError(`${context}.range: min is greater than max`);
    }
    range = { min, max };
  }

  const quantity: CatalogQuantity = {
    key,
    dimension: raw.dimension,
    value,
    approximation: raw.approximation as ApproximationKind,
    declaredUnit: raw.unit,
    ...(range === undefined ? {} : { range }),
    ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
    ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
  };
  return Object.freeze(quantity);
}

function parseVisual(raw: unknown, objectId: string): VisualAsset {
  if (!isRecord(raw) || typeof raw.provider !== 'string') {
    throw new CatalogError(`${objectId}.visuals: expected a provider`);
  }
  if (!(VISUAL_PROVIDERS as readonly string[]).includes(raw.provider)) {
    throw new CatalogError(`${objectId}.visuals: unknown provider ${raw.provider}`);
  }
  return Object.freeze({
    provider: raw.provider as VisualProvider,
    ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
    ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
    ...(typeof raw.attribution === 'string' ? { attribution: raw.attribution } : {}),
  });
}

export function parseScaleObject(raw: unknown): ScaleObject {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new CatalogError(`Object needs an id and a name: ${JSON.stringify(raw)}`);
  }
  // Bind the narrowed id; narrowing a property of a Record does not survive
  // into the callbacks below.
  const id = raw.id;

  if (!isRecord(raw.quantities)) {
    throw new CatalogError(`${id}: expected a quantities map`);
  }

  const quantities: Record<string, CatalogQuantity> = {};
  for (const [key, value] of Object.entries(raw.quantities)) {
    quantities[key] = parseQuantity(key, value, id);
  }
  if (Object.keys(quantities).length === 0) {
    throw new CatalogError(`${id}: an object with no quantities cannot be compared`);
  }

  const semanticDetail = isRecord(raw.semanticDetail)
    ? {
        ...(raw.semanticDetail.minMetersPerPixel === undefined
          ? {}
          : {
              minMetersPerPixel: parseValue(
                raw.semanticDetail.minMetersPerPixel,
                `${id}.semanticDetail.minMetersPerPixel`,
              ),
            }),
        ...(raw.semanticDetail.maxMetersPerPixel === undefined
          ? {}
          : {
              maxMetersPerPixel: parseValue(
                raw.semanticDetail.maxMetersPerPixel,
                `${id}.semanticDetail.maxMetersPerPixel`,
              ),
            }),
      }
    : undefined;

  return Object.freeze({
    id,
    name: raw.name,
    aliases: Object.freeze(Array.isArray(raw.aliases) ? (raw.aliases as string[]) : []),
    quantities: Object.freeze(quantities),
    categories: Object.freeze(Array.isArray(raw.categories) ? (raw.categories as string[]) : []),
    relations: Object.freeze(
      Array.isArray(raw.relations) ? (raw.relations as ObjectRelation[]) : [],
    ),
    visuals: Object.freeze(
      Array.isArray(raw.visuals) ? raw.visuals.map((visual) => parseVisual(visual, id)) : [],
    ),
    ...(semanticDetail === undefined ? {} : { semanticDetail }),
  });
}

/** True when the value is exactly defined rather than measured or representative. */
export function isExactQuantity(quantity: CatalogQuantity): boolean {
  return quantity.approximation === 'exact' && quantity.range === undefined;
}

/**
 * The object's single length quantity, or `undefined` if it has none.
 *
 * Objects in the v0 catalog carry exactly one length. When that stops being
 * true this needs an explicit `primary` field rather than a guess.
 */
export function primaryLength(object: ScaleObject): CatalogQuantity | undefined {
  return Object.values(object.quantities).find((quantity) => quantity.dimension === 'length');
}
